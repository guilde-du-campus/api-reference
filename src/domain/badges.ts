// =============================================================================
// Le domaine · Règles d'attribution des badges
// -----------------------------------------------------------------------------
// Les badges automatiques s'évaluent au moment de la validation d'une quête,
// à partir d'un bilan chiffré de l'aventurier. La fonction est pure : on lui
// donne les compteurs, elle rend les badges mérités. Qui fait les requêtes
// pour construire le bilan ? La couche service, pas le domaine.
//
// Les codes sont des identifiants techniques : anglais. Les noms et
// descriptions sont affichés aux étudiants : français.
// =============================================================================

// Le bilan d'un aventurier au moment de l'évaluation.
export interface AdventurerStats {
  validatedAsTaker: number;
  validatedAsAuthor: number;
  bartersValidatedAsTaker: number;
  distinctCategoriesAsTaker: number; // nombre de catégories distinctes validées
  ownedBadges: ReadonlySet<string>;
}

// La définition des badges automatiques et de leurs conditions.
// La description sert aussi au livre des badges de l'API : une seule source.
export const AUTOMATIC_BADGES = [
  {
    code: "FIRST_QUEST",
    name: "Première quête",
    description: "Réaliser et faire valider sa toute première quête",
    icon: "medal-bronze",
    condition: (s: AdventurerStats) => s.validatedAsTaker >= 1,
  },
  {
    code: "FIRST_POST",
    name: "Premier appel",
    description: "Voir sa première quête postée aboutir à une validation",
    icon: "scroll",
    condition: (s: AdventurerStats) => s.validatedAsAuthor >= 1,
  },
  {
    code: "THREE_IN_A_ROW",
    name: "Série de trois",
    description: "Trois quêtes réalisées et validées",
    icon: "medal-silver",
    condition: (s: AdventurerStats) => s.validatedAsTaker >= 3,
  },
  {
    code: "BIG_HEART",
    name: "Grand cœur",
    description: "Dix quêtes réalisées et validées",
    icon: "medal-gold",
    condition: (s: AdventurerStats) => s.validatedAsTaker >= 10,
  },
  {
    code: "BARTERER",
    name: "Troqueur",
    description: "Son premier troc mené à terme",
    icon: "scales",
    condition: (s: AdventurerStats) => s.bartersValidatedAsTaker >= 1,
  },
  {
    code: "VERSATILE",
    name: "Polyvalent",
    description: "Des quêtes validées dans trois catégories différentes",
    icon: "fan",
    condition: (s: AdventurerStats) => s.distinctCategoriesAsTaker >= 3,
  },
] as const;

// Le badge manuel du maître de guilde : pas de condition, une décision.
export const GUILD_MASTERS_PICK = {
  code: "GUILD_MASTERS_PICK",
  name: "Coup de cœur",
  description: "Décerné par le maître de guilde, quand il veut, à qui il veut",
  icon: "heart",
} as const;

/**
 * Évalue les badges nouvellement mérités : condition remplie ET pas déjà
 * détenus. Retourne les codes à attribuer.
 */
export function earnedBadges(stats: AdventurerStats): string[] {
  return AUTOMATIC_BADGES.filter(
    (badge) => !stats.ownedBadges.has(badge.code) && badge.condition(stats),
  ).map((badge) => badge.code);
}
