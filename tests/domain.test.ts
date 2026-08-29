// =============================================================================
// Tests du domaine : les règles du jeu, sans base ni serveur
// -----------------------------------------------------------------------------
// C'est la démonstration du bénéfice d'un domaine pur : ces tests tournent
// en quelques millisecondes, sans PostgreSQL, sans Fastify, sans réseau.
// Lancement : npm test
// =============================================================================

import { describe, expect, it } from "vitest";
import { earnedBadges, type AdventurerStats } from "../src/domain/badges.js";
import { allowedActions, transition } from "../src/domain/lifecycle.js";
import { levelFromXp, titleFromXp } from "../src/domain/progression.js";

describe("la progression (XP, niveaux, titres)", () => {
  it("démarre au niveau 1, Novice", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(titleFromXp(0)).toBe("Novice");
  });

  it("franchit les paliers exactement sur le seuil", () => {
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(1199)).toBe(6);
    expect(levelFromXp(1200)).toBe(7);
  });

  it("plafonne au dernier titre, même très au-delà", () => {
    expect(titleFromXp(999999)).toBe("Légende de la Guilde");
  });
});

describe("le cycle de vie d'une quête", () => {
  it("suit le chemin heureux : take, complete, validate", () => {
    expect(transition("OPEN", "take")).toBe("IN_PROGRESS");
    expect(transition("IN_PROGRESS", "complete")).toBe("COMPLETED");
    expect(transition("COMPLETED", "validate")).toBe("VALIDATED");
  });

  it("permet l'abandon et l'annulation, chacun depuis le bon état", () => {
    expect(transition("IN_PROGRESS", "abandon")).toBe("OPEN");
    expect(transition("OPEN", "cancel")).toBe("CANCELLED");
  });

  it("refuse toutes les transitions illégales", () => {
    expect(transition("OPEN", "validate")).toBeNull();
    expect(transition("OPEN", "complete")).toBeNull();
    expect(transition("VALIDATED", "take")).toBeNull();
    expect(transition("CANCELLED", "take")).toBeNull();
    expect(transition("COMPLETED", "abandon")).toBeNull();
  });

  it("liste les actions permises depuis chaque état (pour les 409 et les boutons du front)", () => {
    expect(allowedActions("OPEN").sort()).toEqual(["cancel", "take"]);
    expect(allowedActions("IN_PROGRESS").sort()).toEqual(["abandon", "complete"]);
    expect(allowedActions("COMPLETED")).toEqual(["validate"]);
    expect(allowedActions("VALIDATED")).toEqual([]);
    expect(allowedActions("CANCELLED")).toEqual([]);
  });
});

describe("les badges automatiques", () => {
  const emptyStats: AdventurerStats = {
    validatedAsTaker: 0,
    validatedAsAuthor: 0,
    bartersValidatedAsTaker: 0,
    distinctCategoriesAsTaker: 0,
    ownedBadges: new Set(),
  };

  it("n'attribue rien à un aventurier tout neuf", () => {
    expect(earnedBadges(emptyStats)).toEqual([]);
  });

  it("attribue la première quête dès la première validation", () => {
    const stats = { ...emptyStats, validatedAsTaker: 1, distinctCategoriesAsTaker: 1 };
    expect(earnedBadges(stats)).toContain("FIRST_QUEST");
  });

  it("n'attribue jamais deux fois le même badge", () => {
    const stats = {
      ...emptyStats,
      validatedAsTaker: 1,
      distinctCategoriesAsTaker: 1,
      ownedBadges: new Set(["FIRST_QUEST"]),
    };
    expect(earnedBadges(stats)).not.toContain("FIRST_QUEST");
  });

  it("cumule plusieurs badges mérités d'un coup", () => {
    // Dixième validation, troisième catégorie, premier troc : trois badges
    // tombent en même temps (plus les paliers intermédiaires jamais reçus).
    const stats = {
      ...emptyStats,
      validatedAsTaker: 10,
      bartersValidatedAsTaker: 1,
      distinctCategoriesAsTaker: 3,
      ownedBadges: new Set(["FIRST_QUEST", "THREE_IN_A_ROW"]),
    };
    const earned = earnedBadges(stats);
    expect(earned).toContain("BIG_HEART");
    expect(earned).toContain("BARTERER");
    expect(earned).toContain("VERSATILE");
    expect(earned).not.toContain("FIRST_QUEST");
  });
});
