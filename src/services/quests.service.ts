// =============================================================================
// Service des quêtes : les cas d'usage du cycle de vie
// -----------------------------------------------------------------------------
// La couche service orchestre : elle lit, applique les règles du domaine,
// écrit en transaction et retourne le résultat. Les routes restent minces,
// le domaine reste pur, les écritures restent atomiques.
//
// Chaque cas d'usage retourne soit la quête à jour, soit une erreur métier
// typée que la route traduit en HTTP. Le service ne connaît pas Fastify.
// =============================================================================

import type { PrismaClient, Quest, Adventurer } from "@prisma/client";
import { transition, allowedActions, type QuestAction } from "../domain/lifecycle.js";
import { earnedBadges, type AdventurerStats } from "../domain/badges.js";
import { XP_AUTHOR_ON_VALIDATION, XP_TAKER_ON_VALIDATION } from "../domain/progression.js";

type FullQuest = Quest & { author: Adventurer; taker: Adventurer | null };

// Les erreurs métier possibles. La route les traduit en 403, 404 ou 409.
export type QuestError =
  | { code: "NOT_FOUND" }
  | { code: "WRONG_ADVENTURER"; detail: string }
  | { code: "INVALID_TRANSITION"; detail: string }
  | { code: "BUSINESS_RULE"; detail: string };

export type QuestResult =
  | { ok: true; quest: FullQuest; awardedBadges: string[] }
  | { ok: false; error: QuestError };

// L'inclusion systématique : une quête sort toujours avec son auteur
// et son éventuel preneur, comme le contrat l'exige.
const WITH_ACTORS = { author: true, taker: true } as const;

/** Compose le détail d'une erreur de transition, avec les actions permises. */
function transitionDetail(status: Quest["status"], action: QuestAction): string {
  const allowed = allowedActions(status);
  const list = allowed.length > 0 ? allowed.join(", ") : "aucune";
  return `La quête est ${status}, l'action « ${action} » est impossible. Transitions possibles depuis ${status} : ${list}.`;
}

/**
 * Créer une quête : la récompense passe sous séquestre.
 * Le débit du solde et la création se font dans la même transaction :
 * pas de quête sans débit, pas de débit sans quête.
 */
export async function createQuest(
  prisma: PrismaClient,
  authorId: string,
  input: {
    title: string;
    description: string;
    type: "HELP" | "BARTER";
    category: "DEV" | "DESIGN" | "COURSES" | "MATERIAL" | "STUDENT_LIFE" | "OTHER";
    reward: number;
    photoUrl?: string | null;
  },
): Promise<QuestResult> {
  return prisma.$transaction(async (tx) => {
    // updateMany avec condition sur le solde : le refus est atomique.
    // Deux créations simultanées ne peuvent pas passer toutes les deux
    // sous le solde disponible. C'est LA protection contre la concurrence.
    const debit = await tx.adventurer.updateMany({
      where: { id: authorId, helpPoints: { gte: input.reward } },
      data: { helpPoints: { decrement: input.reward } },
    });
    if (debit.count === 0) {
      return {
        ok: false,
        error: {
          code: "BUSINESS_RULE",
          detail: "Points d'entraide insuffisants pour couvrir la récompense.",
        },
      } satisfies QuestResult;
    }

    const quest = await tx.quest.create({
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        category: input.category,
        reward: input.reward,
        photoUrl: input.photoUrl ?? null,
        authorId,
      },
      include: WITH_ACTORS,
    });
    return { ok: true, quest, awardedBadges: [] } satisfies QuestResult;
  });
}

/** Prendre une quête : on ne prend pas la sienne, une seule à la fois. */
export async function takeQuest(
  prisma: PrismaClient,
  questId: string,
  takerId: string,
): Promise<QuestResult> {
  return prisma.$transaction(async (tx) => {
    const quest = await tx.quest.findUnique({ where: { id: questId } });
    if (!quest) return { ok: false, error: { code: "NOT_FOUND" } } satisfies QuestResult;

    if (quest.authorId === takerId) {
      return {
        ok: false,
        error: { code: "BUSINESS_RULE", detail: "On ne prend pas sa propre quête." },
      } satisfies QuestResult;
    }

    const alreadyInProgress = await tx.quest.count({
      where: { takerId, status: "IN_PROGRESS" },
    });
    if (alreadyInProgress > 0) {
      return {
        ok: false,
        error: {
          code: "BUSINESS_RULE",
          detail: "Une seule quête à la fois : termine (ou abandonne) celle en cours d'abord.",
        },
      } satisfies QuestResult;
    }

    const target = transition(quest.status, "take");
    if (!target) {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", detail: transitionDetail(quest.status, "take") },
      } satisfies QuestResult;
    }

    // updateMany conditionné sur le statut : si deux aventuriers cliquent
    // en même temps, un seul gagne la course, l'autre reçoit un 409.
    const taken = await tx.quest.updateMany({
      where: { id: questId, status: "OPEN" },
      data: { status: target, takerId, takenAt: new Date() },
    });
    if (taken.count === 0) {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", detail: transitionDetail("IN_PROGRESS", "take") },
      } satisfies QuestResult;
    }

    const full = await tx.quest.findUniqueOrThrow({
      where: { id: questId },
      include: WITH_ACTORS,
    });
    return { ok: true, quest: full, awardedBadges: [] } satisfies QuestResult;
  });
}

/** Une transition simple réservée à un acteur précis (abandon, complete, cancel). */
async function restrictedTransition(
  prisma: PrismaClient,
  questId: string,
  requesterId: string,
  action: QuestAction,
  actor: "author" | "taker",
  datesToSet: (now: Date) => Partial<Quest>,
): Promise<QuestResult> {
  return prisma.$transaction(async (tx) => {
    const quest = await tx.quest.findUnique({ where: { id: questId } });
    if (!quest) return { ok: false, error: { code: "NOT_FOUND" } } satisfies QuestResult;

    const expectedActor = actor === "author" ? quest.authorId : quest.takerId;
    if (expectedActor !== requesterId) {
      return {
        ok: false,
        error: {
          code: "WRONG_ADVENTURER",
          detail:
            actor === "author"
              ? "Seul l'auteur de la quête peut faire ça."
              : "Seul le preneur de la quête peut faire ça.",
        },
      } satisfies QuestResult;
    }

    const target = transition(quest.status, action);
    if (!target) {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", detail: transitionDetail(quest.status, action) },
      } satisfies QuestResult;
    }

    const data: Partial<Quest> = { status: target, ...datesToSet(new Date()) };
    // L'abandon rend la quête au tableau : le preneur s'efface.
    if (action === "abandon") {
      data.takerId = null;
      data.takenAt = null;
    }
    // L'annulation rembourse le séquestre à l'auteur.
    if (action === "cancel") {
      await tx.adventurer.update({
        where: { id: quest.authorId },
        data: { helpPoints: { increment: quest.reward } },
      });
    }

    await tx.quest.update({ where: { id: questId }, data });
    const full = await tx.quest.findUniqueOrThrow({
      where: { id: questId },
      include: WITH_ACTORS,
    });
    return { ok: true, quest: full, awardedBadges: [] } satisfies QuestResult;
  });
}

export function abandonQuest(prisma: PrismaClient, questId: string, requesterId: string) {
  return restrictedTransition(prisma, questId, requesterId, "abandon", "taker", () => ({}));
}

export function completeQuest(prisma: PrismaClient, questId: string, requesterId: string) {
  return restrictedTransition(prisma, questId, requesterId, "complete", "taker", (now) => ({
    completedAt: now,
  }));
}

export function cancelQuest(prisma: PrismaClient, questId: string, requesterId: string) {
  return restrictedTransition(prisma, questId, requesterId, "cancel", "author", () => ({}));
}

/**
 * Valider une quête : LA transaction du domaine.
 * Dans le même mouvement : le statut change, le séquestre est crédité au
 * preneur, l'XP est attribuée aux deux, et les badges automatiques du
 * preneur ET de l'auteur sont évalués. Tout passe ou rien ne passe.
 */
export async function validateQuest(
  prisma: PrismaClient,
  questId: string,
  requesterId: string,
): Promise<QuestResult> {
  return prisma.$transaction(async (tx) => {
    const quest = await tx.quest.findUnique({ where: { id: questId } });
    if (!quest) return { ok: false, error: { code: "NOT_FOUND" } } satisfies QuestResult;

    if (quest.authorId !== requesterId) {
      return {
        ok: false,
        error: { code: "WRONG_ADVENTURER", detail: "Seul l'auteur de la quête peut valider." },
      } satisfies QuestResult;
    }

    const target = transition(quest.status, "validate");
    if (!target || !quest.takerId) {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", detail: transitionDetail(quest.status, "validate") },
      } satisfies QuestResult;
    }

    // 1. Le statut et la date de validation.
    await tx.quest.update({
      where: { id: questId },
      data: { status: target, validatedAt: new Date() },
    });

    // 2. Le séquestre est crédité au preneur, l'XP aux deux.
    await tx.adventurer.update({
      where: { id: quest.takerId },
      data: {
        helpPoints: { increment: quest.reward },
        xp: { increment: XP_TAKER_ON_VALIDATION },
      },
    });
    await tx.adventurer.update({
      where: { id: quest.authorId },
      data: { xp: { increment: XP_AUTHOR_ON_VALIDATION } },
    });

    // 3. Les badges automatiques, pour le preneur puis pour l'auteur.
    const awarded: string[] = [];
    for (const adventurerId of [quest.takerId, quest.authorId]) {
      const stats = await buildStats(tx, adventurerId);
      for (const code of earnedBadges(stats)) {
        await tx.badgeAward.create({ data: { adventurerId, badgeCode: code } });
        awarded.push(`${adventurerId}:${code}`);
      }
    }

    const full = await tx.quest.findUniqueOrThrow({
      where: { id: questId },
      include: WITH_ACTORS,
    });
    return { ok: true, quest: full, awardedBadges: awarded } satisfies QuestResult;
  });
}

// Le bilan chiffré d'un aventurier, construit pour le domaine des badges.
// tx est le client de LA transaction en cours : le bilan voit la validation
// qui vient d'être écrite, c'est voulu.
async function buildStats(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  adventurerId: string,
): Promise<AdventurerStats> {
  const [asTaker, asAuthor, barters, categories, badges] = await Promise.all([
    tx.quest.count({ where: { takerId: adventurerId, status: "VALIDATED" } }),
    tx.quest.count({ where: { authorId: adventurerId, status: "VALIDATED" } }),
    tx.quest.count({ where: { takerId: adventurerId, status: "VALIDATED", type: "BARTER" } }),
    tx.quest.findMany({
      where: { takerId: adventurerId, status: "VALIDATED" },
      select: { category: true },
      distinct: ["category"],
    }),
    tx.badgeAward.findMany({ where: { adventurerId }, select: { badgeCode: true } }),
  ]);

  return {
    validatedAsTaker: asTaker,
    validatedAsAuthor: asAuthor,
    bartersValidatedAsTaker: barters,
    distinctCategoriesAsTaker: categories.length,
    ownedBadges: new Set(badges.map((b) => b.badgeCode)),
  };
}
