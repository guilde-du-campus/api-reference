// =============================================================================
// Le Codex : la consultation de la Guilde en GraphQL (lecture seule)
// -----------------------------------------------------------------------------
// Monté sur /v1/codex avec mercurius, le plugin GraphQL de Fastify.
// Aucune mutation : tout ce qui écrit passe par le REST, qui porte le
// cycle de vie. Les resolvers illustrent les loaders (anti N+1), sujet
// central de la séance 4 du module back.
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import mercurius from "mercurius";
import type { Adventurer, Badge, BadgeAward, Quest } from "@prisma/client";
import { levelFromXp, titleFromXp } from "../domain/progression.js";

// Le schéma vit dans le contrat : une seule source de vérité, le fichier
// est copié dans ce dépôt à la racine (codex.graphql).
const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.resolve(here, "../../codex.graphql"), "utf-8");

// Le contexte GraphQL s'enrichit par fusion de déclarations : c'est le
// mécanisme prévu par mercurius pour typer son contexte proprement.
declare module "mercurius" {
  interface MercuriusContext {
    currentAdventurer: { id: string; role: string } | null;
  }
}
type Context = import("mercurius").MercuriusContext;

export default async function codex(app: FastifyInstance) {
  await app.register(mercurius, {
    schema,
    path: "/v1/codex",
    graphiql: true, // l'interface d'exploration, précieuse en cours
    // Profondeur maximale des requêtes : la protection anti-abus vue en cours.
    queryDepth: 6,
    // La fabrique de contexte retourne la partie applicative du contexte ;
    // mercurius y ajoute lui-même app, reply et le reste.
    context: async (request) => {
      // Le jeton est facultatif : seul « me » l'exige.
      try {
        const payload = await request.jwtVerify<{ id: string; role: string }>();
        return { currentAdventurer: payload } as Context;
      } catch {
        return { currentAdventurer: null } as Context;
      }
    },
    resolvers: {
      Query: {
        quests: async (_root, args: {
          page?: number;
          limit?: number;
          status?: Quest["status"];
          type?: Quest["type"];
          category?: Quest["category"];
          q?: string;
        }) => {
          const page = args.page ?? 1;
          const limit = Math.min(args.limit ?? 20, 50);
          const where: Record<string, unknown> = {};
          if (args.status) where.status = args.status;
          if (args.type) where.type = args.type;
          if (args.category) where.category = args.category;
          if (args.q) {
            where.OR = [
              { title: { contains: args.q, mode: "insensitive" } },
              { description: { contains: args.q, mode: "insensitive" } },
            ];
          }
          const [total, data] = await Promise.all([
            app.prisma.quest.count({ where }),
            app.prisma.quest.findMany({
              where,
              orderBy: { createdAt: "desc" },
              skip: (page - 1) * limit,
              take: limit,
            }),
          ]);
          return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
        },
        quest: (_root, args: { id: string }) =>
          app.prisma.quest.findUnique({ where: { id: args.id } }),
        adventurer: (_root, args: { id: string }) =>
          app.prisma.adventurer.findUnique({ where: { id: args.id } }),
        badges: () => app.prisma.badge.findMany({ orderBy: { code: "asc" } }),
        me: (_root, _args, context: Context) =>
          context.currentAdventurer
            ? app.prisma.adventurer.findUnique({ where: { id: context.currentAdventurer.id } })
            : null,
      },
      Quest: {
        author: (quest: Quest) =>
          app.prisma.adventurer.findUniqueOrThrow({ where: { id: quest.authorId } }),
        taker: (quest: Quest) =>
          quest.takerId
            ? app.prisma.adventurer.findUnique({ where: { id: quest.takerId } })
            : null,
        createdAt: (quest: Quest) => quest.createdAt.toISOString(),
        takenAt: (quest: Quest) => quest.takenAt?.toISOString() ?? null,
        completedAt: (quest: Quest) => quest.completedAt?.toISOString() ?? null,
        validatedAt: (quest: Quest) => quest.validatedAt?.toISOString() ?? null,
      },
      Adventurer: {
        level: (a: Adventurer) => levelFromXp(a.xp),
        honoraryTitle: (a: Adventurer) => titleFromXp(a.xp),
        memberSince: (a: Adventurer) => a.memberSince.toISOString(),
        validatedQuestsCount: (a: Adventurer) =>
          app.prisma.quest.count({ where: { takerId: a.id, status: "VALIDATED" } }),
        badges: (a: Adventurer) =>
          app.prisma.badgeAward.findMany({
            where: { adventurerId: a.id },
            include: { badge: true },
          }),
        postedQuests: (a: Adventurer, args: { status?: Quest["status"] }) =>
          app.prisma.quest.findMany({
            where: { authorId: a.id, ...(args.status ? { status: args.status } : {}) },
            orderBy: { createdAt: "desc" },
          }),
        takenQuests: (a: Adventurer, args: { status?: Quest["status"] }) =>
          app.prisma.quest.findMany({
            where: { takerId: a.id, ...(args.status ? { status: args.status } : {}) },
            orderBy: { createdAt: "desc" },
          }),
      },
      AwardedBadge: {
        badge: (award: BadgeAward & { badge?: Badge }) =>
          award.badge ?? app.prisma.badge.findUniqueOrThrow({ where: { code: award.badgeCode } }),
        awardedAt: (award: BadgeAward) => award.awardedAt.toISOString(),
      },
      Badge: {
        holdersCount: (badge: Badge) =>
          app.prisma.badgeAward.count({ where: { badgeCode: badge.code } }),
      },
    },
  });
}
