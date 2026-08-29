// =============================================================================
// Routes d'authentification : inscription, connexion, rafraîchissement
// -----------------------------------------------------------------------------
// Les choix de sécurité, tous discutés en cours :
//  · argon2id pour hacher les mots de passe (recommandation OWASP) ;
//  · 12 caractères minimum, pas de règle de composition (CNIL) ;
//  · jeton d'accès 15 minutes, jeton de rafraîchissement 7 jours AVEC
//    rotation : chaque rafraîchissement consomme l'ancien jeton ;
//  · en cas d'identifiants invalides, le message ne dit jamais si c'est
//    l'email ou le mot de passe qui cloche.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { conflict, sendProblem, unauthorized } from "../utils/problems.js";
import { serializePrivateProfile } from "../utils/serializers.js";

const REFRESH_TOKEN_DAYS = 7;

// Le jeton de rafraîchissement est une chaîne aléatoire opaque. En base,
// on ne stocke que son empreinte SHA-256 : une fuite de la base ne donne
// aucun jeton utilisable.
function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default async function authRoutes(app: FastifyInstance) {
  // Génère la paire de jetons et persiste l'empreinte du rafraîchissement.
  async function issueTokens(adventurerId: string, role: "MEMBER" | "GUILD_MASTER") {
    const accessToken = app.jwt.sign({ id: adventurerId, role });
    const refreshToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 3600 * 1000);
    await app.prisma.refreshToken.create({
      data: { tokenHash: fingerprint(refreshToken), adventurerId, expiresAt },
    });
    return { accessToken, refreshToken };
  }

  // Le profil privé complet, pour la réponse des trois routes.
  async function fullProfile(adventurerId: string) {
    const adventurer = await app.prisma.adventurer.findUniqueOrThrow({
      where: { id: adventurerId },
    });
    const badges = await app.prisma.badgeAward.findMany({
      where: { adventurerId },
      include: { badge: true },
    });
    const validatedQuestsCount = await app.prisma.quest.count({
      where: { takerId: adventurerId, status: "VALIDATED" },
    });
    return serializePrivateProfile(adventurer, badges, validatedQuestsCount);
  }

  // --- POST /auth/register --------------------------------------------------
  app.post(
    "/auth/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "email", "password"],
          additionalProperties: false,
          properties: {
            username: { type: "string", minLength: 3, maxLength: 30, pattern: "^[\\p{L}0-9_-]+$" },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 12 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, email, password } = request.body as {
        username: string;
        email: string;
        password: string;
      };

      // L'unicité est aussi garantie par la base (contrainte unique) :
      // la vérification préalable sert un message d'erreur propre, la
      // contrainte sert la concurrence. Les deux comptent.
      const existing = await app.prisma.adventurer.findFirst({
        where: { OR: [{ username }, { email }] },
      });
      if (existing) {
        return conflict(
          reply,
          existing.username === username ? "Ce pseudo est déjà pris." : "Cet email est déjà utilisé.",
        );
      }

      const adventurer = await app.prisma.adventurer.create({
        data: {
          username,
          email,
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        },
      });

      const tokens = await issueTokens(adventurer.id, adventurer.role);
      return reply.status(201).send({ ...tokens, adventurer: await fullProfile(adventurer.id) });
    },
  );

  // --- POST /auth/login -----------------------------------------------------
  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      const adventurer = await app.prisma.adventurer.findUnique({ where: { email } });

      // Message volontairement flou : ne jamais confirmer qu'un email existe.
      const invalidCredentials = () =>
        sendProblem(reply, {
          status: 401,
          family: "invalid-credentials",
          title: "Identifiants invalides",
          detail: "Email ou mot de passe incorrect.",
        });

      if (!adventurer) return invalidCredentials();
      const valid = await argon2.verify(adventurer.passwordHash, password);
      if (!valid) return invalidCredentials();

      const tokens = await issueTokens(adventurer.id, adventurer.role);
      return reply.send({ ...tokens, adventurer: await fullProfile(adventurer.id) });
    },
  );

  // --- POST /auth/refresh ---------------------------------------------------
  app.post(
    "/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          additionalProperties: false,
          properties: { refreshToken: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      const stored = await app.prisma.refreshToken.findUnique({
        where: { tokenHash: fingerprint(refreshToken) },
        include: { adventurer: true },
      });

      if (!stored || stored.expiresAt < new Date()) {
        return unauthorized(reply, "Jeton de rafraîchissement expiré ou inconnu.");
      }
      if (stored.usedAt) {
        // Rejeu détecté : un jeton déjà consommé revient. Par prudence,
        // on révoque toute la famille de jetons de cet aventurier.
        await app.prisma.refreshToken.deleteMany({
          where: { adventurerId: stored.adventurerId },
        });
        return unauthorized(reply, "Jeton déjà utilisé : toutes les sessions sont révoquées.");
      }

      // Rotation : l'ancien est marqué consommé, un nouveau est émis.
      await app.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      });

      const tokens = await issueTokens(stored.adventurerId, stored.adventurer.role);
      return reply.send({ ...tokens, adventurer: await fullProfile(stored.adventurerId) });
    },
  );
}
