// =============================================================================
// Routes des aventuriers : profils, liste, badge manuel
// =============================================================================

import type { FastifyInstance } from "fastify";
import { conflict, notFound } from "../utils/problems.js";
import {
  serializeBadgeAward,
  serializePrivateProfile,
  serializePublicProfile,
} from "../utils/serializers.js";

export default async function adventurerRoutes(app: FastifyInstance) {
  // Le profil public complet d'un aventurier, badges et compteur compris.
  async function loadPublicProfile(id: string) {
    const adventurer = await app.prisma.adventurer.findUnique({ where: { id } });
    if (!adventurer) return null;
    const badges = await app.prisma.badgeAward.findMany({
      where: { adventurerId: id },
      include: { badge: true },
    });
    const validatedQuestsCount = await app.prisma.quest.count({
      where: { takerId: id, status: "VALIDATED" },
    });
    return serializePublicProfile(adventurer, badges, validatedQuestsCount);
  }

  // Le profil privé du connecté (réutilisé par GET et PATCH /me).
  async function loadPrivateProfile(id: string) {
    const adventurer = await app.prisma.adventurer.findUniqueOrThrow({ where: { id } });
    const badges = await app.prisma.badgeAward.findMany({
      where: { adventurerId: id },
      include: { badge: true },
    });
    const validatedQuestsCount = await app.prisma.quest.count({
      where: { takerId: id, status: "VALIDATED" },
    });
    return serializePrivateProfile(adventurer, badges, validatedQuestsCount);
  }

  // --- GET /me ---------------------------------------------------------------
  app.get("/me", { preHandler: app.requireAuth }, async (request) => {
    return loadPrivateProfile(request.user.id);
  });

  // --- PATCH /me -------------------------------------------------------------
  app.patch(
    "/me",
    {
      preHandler: app.requireAuth,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            username: { type: "string", minLength: 3, maxLength: 30, pattern: "^[\\p{L}0-9_-]+$" },
            avatarUrl: { type: ["string", "null"], format: "uri" },
          },
        },
      },
    },
    async (request, reply) => {
      const input = request.body as { username?: string; avatarUrl?: string | null };

      if (input.username) {
        const taken = await app.prisma.adventurer.findFirst({
          where: { username: input.username, id: { not: request.user.id } },
        });
        if (taken) return conflict(reply, "Ce pseudo est déjà pris.");
      }

      await app.prisma.adventurer.update({ where: { id: request.user.id }, data: input });
      return loadPrivateProfile(request.user.id);
    },
  );

  // --- GET /adventurers ------------------------------------------------------
  app.get(
    "/adventurers",
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            sort: {
              type: "string",
              enum: ["username", "-username", "xp", "-xp", "helpPoints", "-helpPoints"],
              default: "-xp",
            },
          },
        },
      },
    },
    async (request) => {
      const { page, limit, sort } = request.query as { page: number; limit: number; sort: string };

      // Le tri "-xp" devient { xp: "desc" } : petite traduction sans magie.
      const field = sort.startsWith("-") ? sort.slice(1) : sort;
      const direction = sort.startsWith("-") ? "desc" : "asc";

      const [total, adventurers] = await Promise.all([
        app.prisma.adventurer.count(),
        app.prisma.adventurer.findMany({
          orderBy: { [field]: direction },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      // Pour une liste, on charge les compteurs et les badges en une passe
      // par groupe, pas un aller-retour par aventurier (le fameux N+1 : le
      // module back y consacre un moment, le code de référence montre le bon
      // geste dès le S1).
      const ids = adventurers.map((a) => a.id);
      const [badges, counters] = await Promise.all([
        app.prisma.badgeAward.findMany({
          where: { adventurerId: { in: ids } },
          include: { badge: true },
        }),
        app.prisma.quest.groupBy({
          by: ["takerId"],
          where: { takerId: { in: ids }, status: "VALIDATED" },
          _count: { _all: true },
        }),
      ]);

      const data = adventurers.map((a) =>
        serializePublicProfile(
          a,
          badges.filter((b) => b.adventurerId === a.id),
          counters.find((c) => c.takerId === a.id)?._count._all ?? 0,
        ),
      );

      return { page, limit, total, totalPages: Math.ceil(total / limit), data };
    },
  );

  // --- GET /adventurers/:id --------------------------------------------------
  app.get("/adventurers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = await loadPublicProfile(id);
    if (!profile) return notFound(reply, "Cet aventurier n'existe pas.");
    return profile;
  });

  // --- POST /adventurers/:id/badges (maître de guilde) -----------------------
  app.post(
    "/adventurers/:id/badges",
    {
      preHandler: app.requireGuildMaster,
      schema: {
        body: {
          type: "object",
          required: ["badgeCode"],
          additionalProperties: false,
          properties: { badgeCode: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { badgeCode } = request.body as { badgeCode: string };

      const [adventurer, badge] = await Promise.all([
        app.prisma.adventurer.findUnique({ where: { id } }),
        app.prisma.badge.findUnique({ where: { code: badgeCode } }),
      ]);
      if (!adventurer) return notFound(reply, "Cet aventurier n'existe pas.");
      if (!badge) return notFound(reply, `Le badge ${badgeCode} n'existe pas.`);

      const already = await app.prisma.badgeAward.findUnique({
        where: { adventurerId_badgeCode: { adventurerId: id, badgeCode } },
      });
      if (already) return conflict(reply, "Cet aventurier possède déjà ce badge.");

      const award = await app.prisma.badgeAward.create({
        data: { adventurerId: id, badgeCode },
        include: { badge: true },
      });

      // La bonne nouvelle part en temps réel, comme au contrat.
      app.notify(id, {
        event: "badge.awarded",
        data: { badgeCode, name: badge.name },
      });

      return reply.status(201).send(serializeBadgeAward(award));
    },
  );
}
