// =============================================================================
// La graine : une Guilde vivante dès le premier lancement
// -----------------------------------------------------------------------------
// Des aventuriers avec du caractère, des quêtes crédibles et drôles, des
// badges déjà gagnés : les écrans du front ont de l'allure dès la séance 1.
// Le script est idempotent : le relancer ne duplique rien (upsert partout),
// à l'exception des quêtes, reconstruites pour une démo prévisible.
//
// Tous les comptes de démo partagent le même mot de passe :
//   « guilde-demo-2026! »
// =============================================================================

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { AUTOMATIC_BADGES, GUILD_MASTERS_PICK } from "../src/domain/badges.js";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "guilde-demo-2026!";

// Les personnages de la démo. Le maître de guilde, c'est le formateur.
const ADVENTURERS = [
  { username: "MaitreMarius", email: "maitre@guilde.local", role: "GUILD_MASTER", xp: 1300, points: 500 },
  { username: "Lancelot_du_Lag", email: "lancelot@guilde.local", role: "MEMBER", xp: 320, points: 145 },
  { username: "Morgane_la_Merge", email: "morgane@guilde.local", role: "MEMBER", xp: 510, points: 210 },
  { username: "Perceval_404", email: "perceval@guilde.local", role: "MEMBER", xp: 95, points: 80 },
  { username: "Viviane_Vim", email: "viviane@guilde.local", role: "MEMBER", xp: 160, points: 120 },
  { username: "Galaad_du_Gradle", email: "galaad@guilde.local", role: "MEMBER", xp: 30, points: 100 },
] as const;

// Des quêtes qui sentent le vrai campus, réparties sur tout le cycle de vie.
const QUESTS = [
  {
    title: "SOS régression CSS avant la démo de vendredi",
    description:
      "Ma grille se casse en dessous de 768 px et je présente vendredi. Un œil expert sur mon media query me sauverait la semaine.",
    type: "HELP",
    category: "DEV",
    reward: 30,
    status: "OPEN",
    author: "Perceval_404",
  },
  {
    title: "Troc : clavier mécanique contre cours de TypeScript",
    description:
      "Je troque mon clavier 75 % (switches rouges, très bon état) contre deux séances sérieuses de remise à niveau TypeScript. Générics compris.",
    type: "BARTER",
    category: "MATERIAL",
    reward: 0,
    status: "OPEN",
    author: "Viviane_Vim",
  },
  {
    title: "Relecture de mon rapport d'alternance (20 pages)",
    description:
      "Orthographe, tournures, cohérence. Je fournis les croissants et une gratitude éternelle.",
    type: "HELP",
    category: "COURSES",
    reward: 25,
    status: "OPEN",
    author: "Lancelot_du_Lag",
  },
  {
    title: "Aide pour déboguer un useEffect qui boucle",
    description:
      "Mon composant re-rend à l'infini et la console ressemble à un sapin de Noël. Quelqu'un pour une session de pair debugging ?",
    type: "HELP",
    category: "DEV",
    reward: 40,
    status: "IN_PROGRESS",
    author: "Galaad_du_Gradle",
    taker: "Morgane_la_Merge",
  },
  {
    title: "Shooting photo pour mon portfolio",
    description:
      "Besoin de trois portraits corrects pour mon site et LinkedIn. J'ai le mur en briques, il me manque l'œil.",
    type: "HELP",
    category: "DESIGN",
    reward: 35,
    status: "COMPLETED",
    author: "Morgane_la_Merge",
    taker: "Lancelot_du_Lag",
  },
  {
    title: "Installer Linux en dual boot sans rien casser",
    description:
      "Un portable, deux systèmes, zéro larme. Accompagnement demandé, pizza offerte pendant les barres de progression.",
    type: "HELP",
    category: "STUDENT_LIFE",
    reward: 20,
    status: "VALIDATED",
    author: "Viviane_Vim",
    taker: "Lancelot_du_Lag",
  },
  {
    title: "Troc : cours de montage vidéo contre aide SQL",
    description:
      "Je maîtrise DaVinci Resolve, tu maîtrises les jointures. Échangeons nos superpouvoirs, deux heures chacun.",
    type: "BARTER",
    category: "COURSES",
    reward: 0,
    status: "VALIDATED",
    author: "Perceval_404",
    taker: "Morgane_la_Merge",
  },
  {
    title: "Récupérer mon vélo chez le réparateur avant 18 h",
    description:
      "Coincé en entreprise jusqu'à 19 h et le magasin ferme avant. Le ticket est payé, il n'y a qu'à le pousser jusqu'au campus.",
    type: "HELP",
    category: "STUDENT_LIFE",
    reward: 15,
    status: "CANCELLED",
    author: "Morgane_la_Merge",
  },
] as const;

async function seed() {
  console.log("🌱 Plantation de la graine de la Guilde...");

  // 1. Les badges : les automatiques du domaine + le manuel du maître.
  for (const badge of AUTOMATIC_BADGES) {
    await prisma.badge.upsert({
      where: { code: badge.code },
      update: { name: badge.name, description: badge.description, icon: badge.icon },
      create: {
        code: badge.code,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        automatic: true,
      },
    });
  }
  await prisma.badge.upsert({
    where: { code: GUILD_MASTERS_PICK.code },
    update: {},
    create: { ...GUILD_MASTERS_PICK, automatic: false },
  });

  // 2. Les aventuriers. Le même hachage pour tous : c'est une démo.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const byUsername = new Map<string, string>();
  for (const a of ADVENTURERS) {
    const created = await prisma.adventurer.upsert({
      where: { email: a.email },
      update: { xp: a.xp, helpPoints: a.points },
      create: {
        username: a.username,
        email: a.email,
        passwordHash,
        role: a.role,
        xp: a.xp,
        helpPoints: a.points,
      },
    });
    byUsername.set(a.username, created.id);
  }

  // 3. Les quêtes, avec des dates cohérentes avec leur statut.
  //    On repart d'une table vide pour garder une démo prévisible.
  await prisma.quest.deleteMany();
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 3600 * 1000);
  let offset = QUESTS.length + 2;

  for (const q of QUESTS) {
    const authorId = byUsername.get(q.author);
    if (!authorId) continue;
    const takerId = "taker" in q ? byUsername.get(q.taker) : undefined;
    const createdAt = daysAgo(offset--);

    await prisma.quest.create({
      data: {
        title: q.title,
        description: q.description,
        type: q.type,
        category: q.category,
        reward: q.reward,
        status: q.status,
        authorId,
        takerId: takerId ?? null,
        createdAt,
        takenAt: takerId ? new Date(createdAt.getTime() + 3600 * 1000) : null,
        completedAt:
          q.status === "COMPLETED" || q.status === "VALIDATED"
            ? new Date(createdAt.getTime() + 26 * 3600 * 1000)
            : null,
        validatedAt:
          q.status === "VALIDATED" ? new Date(createdAt.getTime() + 30 * 3600 * 1000) : null,
      },
    });
  }

  // 4. Quelques badges déjà gagnés, cohérents avec l'historique ci-dessus.
  const award = async (username: string, badgeCode: string) => {
    const adventurerId = byUsername.get(username);
    if (!adventurerId) return;
    await prisma.badgeAward.upsert({
      where: { adventurerId_badgeCode: { adventurerId, badgeCode } },
      update: {},
      create: { adventurerId, badgeCode },
    });
  };
  await award("Lancelot_du_Lag", "FIRST_QUEST");
  await award("Morgane_la_Merge", "FIRST_QUEST");
  await award("Morgane_la_Merge", "BARTERER");
  await award("Viviane_Vim", "FIRST_POST");
  await award("Perceval_404", "FIRST_POST");
  await award("Morgane_la_Merge", "GUILD_MASTERS_PICK");

  console.log("🌳 La Guilde est peuplée :");
  console.log(`   ${ADVENTURERS.length} aventuriers (mot de passe commun : ${DEMO_PASSWORD})`);
  console.log(`   ${QUESTS.length} quêtes réparties sur tout le cycle de vie`);
  console.log(`   ${AUTOMATIC_BADGES.length + 1} badges au livre`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
