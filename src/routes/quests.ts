// =============================================================================
// Routes des quêtes : le tableau, le cycle de vie, la modération
// -----------------------------------------------------------------------------
// Les routes restent minces : validation du schéma, appel du service,
// traduction du résultat en HTTP, notification temps réel. Les règles
// vivent dans le domaine et le service.
// =============================================================================

import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  abandonQuest,
  cancelQuest,
  completeQuest,
  createQuest,
  takeQuest,
  validateQuest,
  type QuestResult,
} from "../services/quests.service.js";
import { XP_TAKER_ON_VALIDATION } from "../domain/progression.js";
import { conflict, forbidden, invalidTransition, notFound } from "../utils/problems.js";
import { serializeQuest } from "../utils/serializers.js";

export default async function questRoutes(app: FastifyInstance) {
  // Traduit une erreur métier du service en réponse HTTP RFC 7807.
  function translateError(reply: FastifyReply, result: Extract<QuestResult, { ok: false }>) {
    switch (result.error.code) {
      case "NOT_FOUND":
        return notFound(reply, "Cette quête n'existe pas.");
      case "WRONG_ADVENTURER":
        return forbidden(reply, result.error.detail);
      case "INVALID_TRANSITION":
        return invalidTransition(reply, result.error.detail);
      case "BUSINESS_RULE":
        return conflict(reply, result.error.detail, "business-rule");
    }
  }

  // --- GET /quests : le tableau, public --------------------------------------
  app.get(
    "/quests",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            status: {
              type: "string",
              enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "VALIDATED", "CANCELLED"],
            },
            type: { type: "string", enum: ["HELP", "BARTER"] },
            category: {
              type: "string",
              enum: ["DEV", "DESIGN", "COURSES", "MATERIAL", "STUDENT_LIFE", "OTHER"],
            },
            authorId: { type: "string", format: "uuid" },
            takerId: { type: "string", format: "uuid" },
            q: { type: "string", maxLength: 100 },
            sort: {
              type: "string",
              enum: ["createdAt", "-createdAt", "reward", "-reward"],
              default: "-createdAt",
            },
          },
        },
      },
    },
    async (request) => {
      const filters = request.query as {
        page: number;
        limit: number;
        status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "VALIDATED" | "CANCELLED";
        type?: "HELP" | "BARTER";
        category?: "DEV" | "DESIGN" | "COURSES" | "MATERIAL" | "STUDENT_LIFE" | "OTHER";
        authorId?: string;
        takerId?: string;
        q?: string;
        sort: string;
      };

      // La clause where se construit morceau par morceau : chaque filtre
      // absent n'ajoute rien. C'est lisible et ça n'invente pas de SQL.
      const where: Prisma.QuestWhereInput = {};
      if (filters.status) where.status = filters.status;
      if (filters.type) where.type = filters.type;
      if (filters.category) where.category = filters.category;
      if (filters.authorId) where.authorId = filters.authorId;
      if (filters.takerId) where.takerId = filters.takerId;
      if (filters.q) {
        // Recherche simple, insensible à la casse, sur le titre et la
        // description. La recherche plein texte PostgreSQL est une extension.
        where.OR = [
          { title: { contains: filters.q, mode: "insensitive" } },
          { description: { contains: filters.q, mode: "insensitive" } },
        ];
      }

      const field = filters.sort.startsWith("-") ? filters.sort.slice(1) : filters.sort;
      const direction = filters.sort.startsWith("-") ? "desc" : "asc";

      const [total, quests] = await Promise.all([
        app.prisma.quest.count({ where }),
        app.prisma.quest.findMany({
          where,
          orderBy: { [field]: direction },
          skip: (filters.page - 1) * filters.limit,
          take: filters.limit,
          include: { author: true, taker: true },
        }),
      ]);

      return {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
        data: quests.map(serializeQuest),
      };
    },
  );

  // --- POST /quests -----------------------------------------------------------
  app.post(
    "/quests",
    {
      preHandler: app.requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["title", "description", "type", "category", "reward"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 5, maxLength: 120 },
            description: { type: "string", maxLength: 2000 },
            type: { type: "string", enum: ["HELP", "BARTER"] },
            category: {
              type: "string",
              enum: ["DEV", "DESIGN", "COURSES", "MATERIAL", "STUDENT_LIFE", "OTHER"],
            },
            reward: { type: "integer", minimum: 0, maximum: 500 },
            photoUrl: { type: ["string", "null"], format: "uri" },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await createQuest(app.prisma, request.user.id, request.body as never);
      if (!result.ok) return translateError(reply, result);
      return reply
        .status(201)
        .header("location", `/v1/quests/${result.quest.id}`)
        .send(serializeQuest(result.quest));
    },
  );

  // --- GET /quests/:id ---------------------------------------------------------
  app.get("/quests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const quest = await app.prisma.quest.findUnique({
      where: { id },
      include: { author: true, taker: true },
    });
    if (!quest) return notFound(reply, "Cette quête n'existe pas.");
    return serializeQuest(quest);
  });

  // --- PATCH /quests/:id : modifiable par l'auteur, statut OPEN seulement ----
  app.patch(
    "/quests/:id",
    {
      preHandler: app.requireAuth,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 5, maxLength: 120 },
            description: { type: "string", maxLength: 2000 },
            category: {
              type: "string",
              enum: ["DEV", "DESIGN", "COURSES", "MATERIAL", "STUDENT_LIFE", "OTHER"],
            },
            reward: { type: "integer", minimum: 0, maximum: 500 },
            photoUrl: { type: ["string", "null"], format: "uri" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = request.body as {
        title?: string;
        description?: string;
        category?: "DEV" | "DESIGN" | "COURSES" | "MATERIAL" | "STUDENT_LIFE" | "OTHER";
        reward?: number;
        photoUrl?: string | null;
      };

      const quest = await app.prisma.quest.findUnique({ where: { id } });
      if (!quest) return notFound(reply, "Cette quête n'existe pas.");
      if (quest.authorId !== request.user.id) {
        return forbidden(reply, "Seul l'auteur peut modifier sa quête.");
      }
      if (quest.status !== "OPEN") {
        return invalidTransition(
          reply,
          `La quête est ${quest.status} : seule une quête OPEN se modifie.`,
        );
      }

      // Changer la récompense ajuste le séquestre, dans les deux sens,
      // et toujours en transaction avec la mise à jour de la quête.
      const newReward = input.reward ?? quest.reward;
      const delta = newReward - quest.reward;

      const updated = await app.prisma.$transaction(async (tx) => {
        if (delta !== 0) {
          const debit = await tx.adventurer.updateMany({
            where:
              delta > 0
                ? { id: quest.authorId, helpPoints: { gte: delta } }
                : { id: quest.authorId },
            data: { helpPoints: { decrement: delta } },
          });
          if (debit.count === 0) return null; // solde insuffisant pour l'augmentation
        }
        return tx.quest.update({
          where: { id },
          data: input,
          include: { author: true, taker: true },
        });
      });

      if (!updated) {
        return conflict(reply, "Points d'entraide insuffisants pour augmenter la récompense.", "business-rule");
      }
      return serializeQuest(updated);
    },
  );

  // --- DELETE /quests/:id : modération, maître de guilde seulement -----------
  app.delete("/quests/:id", { preHandler: app.requireGuildMaster }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quest = await app.prisma.quest.findUnique({ where: { id } });
    if (!quest) return notFound(reply, "Cette quête n'existe pas.");

    await app.prisma.$transaction(async (tx) => {
      // Si le séquestre court toujours, il revient à l'auteur.
      if (quest.status === "OPEN" || quest.status === "IN_PROGRESS" || quest.status === "COMPLETED") {
        await tx.adventurer.update({
          where: { id: quest.authorId },
          data: { helpPoints: { increment: quest.reward } },
        });
      }
      await tx.quest.delete({ where: { id } });
    });

    return reply.status(204).send();
  });

  // --- Les cinq actions du cycle de vie ---------------------------------------

  app.post("/quests/:id/take", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await takeQuest(app.prisma, id, request.user.id);
    if (!result.ok) return translateError(reply, result);

    // L'auteur apprend la bonne nouvelle en direct.
    const { quest } = result;
    if (quest.taker) {
      app.notify(quest.authorId, {
        event: "quest.taken",
        data: {
          questId: quest.id,
          title: quest.title,
          taker: { id: quest.taker.id, username: quest.taker.username },
        },
      });
    }
    return serializeQuest(quest);
  });

  app.post("/quests/:id/abandon", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await abandonQuest(app.prisma, id, request.user.id);
    if (!result.ok) return translateError(reply, result);
    return serializeQuest(result.quest);
  });

  app.post("/quests/:id/complete", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await completeQuest(app.prisma, id, request.user.id);
    if (!result.ok) return translateError(reply, result);

    app.notify(result.quest.authorId, {
      event: "quest.completed",
      data: { questId: result.quest.id, title: result.quest.title },
    });
    return serializeQuest(result.quest);
  });

  app.post("/quests/:id/validate", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await validateQuest(app.prisma, id, request.user.id);
    if (!result.ok) return translateError(reply, result);

    const { quest } = result;
    if (quest.takerId) {
      // Le preneur reçoit ses gains en direct...
      app.notify(quest.takerId, {
        event: "quest.validated",
        data: {
          questId: quest.id,
          title: quest.title,
          pointsEarned: quest.reward,
          xpEarned: XP_TAKER_ON_VALIDATION,
        },
      });
      // ... et chacun ses éventuels badges tout frais.
      for (const entry of result.awardedBadges) {
        const [adventurerId, badgeCode] = entry.split(":");
        if (adventurerId && badgeCode) {
          const badge = await app.prisma.badge.findUnique({ where: { code: badgeCode } });
          if (badge) {
            app.notify(adventurerId, {
              event: "badge.awarded",
              data: { badgeCode, name: badge.name },
            });
          }
        }
      }
    }
    return serializeQuest(quest);
  });

  app.post("/quests/:id/cancel", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await cancelQuest(app.prisma, id, request.user.id);
    if (!result.ok) return translateError(reply, result);
    return serializeQuest(result.quest);
  });
}
