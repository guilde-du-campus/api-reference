// =============================================================================
// Le domaine · Progression (XP, niveaux, titres)
// -----------------------------------------------------------------------------
// Logique métier pure : aucune dépendance à Fastify, à Prisma ou au réseau.
// C'est voulu, et c'est un des messages du cours (séance 3 du back) :
// les règles du jeu se testent sans base de données ni serveur.
// =============================================================================

// Les gains d'expérience à la validation d'une quête.
// L'auteur gagne aussi : poster et suivre une quête fait vivre la Guilde.
export const XP_TAKER_ON_VALIDATION = 25;
export const XP_AUTHOR_ON_VALIDATION = 10;

// Les points de bienvenue crédités à l'inscription.
export const WELCOME_POINTS = 100;

// Les paliers de niveaux : XP cumulée minimale et titre honorifique.
// Les titres sont en français : c'est du contenu affiché, pas du code.
// La liste est triée par XP croissante, le calcul en dépend.
const LEVELS: ReadonlyArray<{ level: number; minXp: number; title: string }> = [
  { level: 1, minXp: 0, title: "Novice" },
  { level: 2, minXp: 50, title: "Apprenti" },
  { level: 3, minXp: 150, title: "Compagnon" },
  { level: 4, minXp: 300, title: "Aventurier confirmé" },
  { level: 5, minXp: 500, title: "Expert" },
  { level: 6, minXp: 800, title: "Maître d'œuvre" },
  { level: 7, minXp: 1200, title: "Légende de la Guilde" },
];

/**
 * Calcule le niveau depuis l'XP cumulée.
 * Le niveau n'est jamais stocké en base : c'est une donnée dérivée.
 */
export function levelFromXp(xp: number): number {
  // On parcourt les paliers du plus haut au plus bas et l'on retient
  // le premier dont le seuil est atteint.
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const step = LEVELS[i];
    if (step && xp >= step.minXp) {
      return step.level;
    }
  }
  return 1; // Filet de sécurité : une XP négative n'existe pas, mais au cas où.
}

/** Le titre honorifique associé au niveau. */
export function titleFromXp(xp: number): string {
  const level = levelFromXp(xp);
  const step = LEVELS.find((s) => s.level === level);
  return step ? step.title : "Novice";
}
