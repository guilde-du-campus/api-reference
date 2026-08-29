// =============================================================================
// Sérialisation des ressources : de l'entité Prisma au JSON du contrat
// -----------------------------------------------------------------------------
// Une seule responsabilité : décider ce qui sort de l'API et sous quelle
// forme. Le hachage du mot de passe, l'email d'autrui, le rôle des autres :
// rien de tout ça ne doit fuiter. C'est ici que ça se joue, à un seul endroit.
// =============================================================================

import type { Adventurer, BadgeAward, Badge, Quest } from "@prisma/client";
import { levelFromXp, titleFromXp } from "../domain/progression.js";

type FullBadgeAward = BadgeAward & { badge: Badge };

/** La carte de visite minimale, utilisée dans les listes et les quêtes. */
export function serializeSummary(a: Adventurer) {
  return {
    id: a.id,
    username: a.username,
    avatarUrl: a.avatarUrl,
    level: levelFromXp(a.xp),
  };
}

/** Le profil public : ce que tout le monde voit. */
export function serializePublicProfile(
  a: Adventurer,
  badges: FullBadgeAward[],
  validatedQuestsCount: number,
) {
  return {
    id: a.id,
    username: a.username,
    avatarUrl: a.avatarUrl,
    level: levelFromXp(a.xp),
    xp: a.xp,
    honoraryTitle: titleFromXp(a.xp),
    badges: badges.map(serializeBadgeAward),
    validatedQuestsCount,
    memberSince: a.memberSince.toISOString(),
  };
}

/** Le profil privé : le public + ce que seul le propriétaire voit. */
export function serializePrivateProfile(
  a: Adventurer,
  badges: FullBadgeAward[],
  validatedQuestsCount: number,
) {
  return {
    ...serializePublicProfile(a, badges, validatedQuestsCount),
    email: a.email,
    helpPoints: a.helpPoints,
    role: a.role,
  };
}

export function serializeBadgeAward(award: FullBadgeAward) {
  return {
    code: award.badge.code,
    name: award.badge.name,
    description: award.badge.description,
    icon: award.badge.icon,
    automatic: award.badge.automatic,
    awardedAt: award.awardedAt.toISOString(),
  };
}

type FullQuest = Quest & { author: Adventurer; taker: Adventurer | null };

/** Une quête telle que le contrat la décrit, auteur et preneur en résumé. */
export function serializeQuest(q: FullQuest) {
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    type: q.type,
    category: q.category,
    status: q.status,
    reward: q.reward,
    photoUrl: q.photoUrl,
    author: serializeSummary(q.author),
    taker: q.taker ? serializeSummary(q.taker) : null,
    createdAt: q.createdAt.toISOString(),
    takenAt: q.takenAt?.toISOString() ?? null,
    completedAt: q.completedAt?.toISOString() ?? null,
    validatedAt: q.validatedAt?.toISOString() ?? null,
  };
}
