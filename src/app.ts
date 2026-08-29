// =============================================================================
// L'assemblage de l'application
// -----------------------------------------------------------------------------
// app.ts construit et retourne l'application Fastify complète, sans
// l'écouter : c'est ce qui permet de la tester (inject) sans ouvrir de
// port. server.ts, lui, écoute. La séparation est un classique à retenir.
// =============================================================================

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import Fastify from "fastify";
import codex from "./codex/index.js";
import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import realtimePlugin from "./plugins/realtime.js";
import authRoutes from "./routes/auth.js";
import adventurerRoutes from "./routes/adventurers.js";
import badgeRoutes from "./routes/badges.js";
import mediaRoutes from "./routes/media.js";
import questRoutes from "./routes/quests.js";
import { sendProblem } from "./utils/problems.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      // Logs structurés en JSON : c'est ce que les outils d'observabilité
      // savent lire. En développement, pino-pretty les rend lisibles.
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // CORS : le front (localhost:3001, Vercel...) appelle depuis un autre
  // domaine. La liste des origines vient de l'environnement.
  await app.register(cors, {
    origin: (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001").split(","),
  });

  // Les erreurs de validation de schéma sortent au format RFC 7807,
  // comme toutes les autres erreurs de l'API. Le gestionnaire se pose
  // AVANT les routes : chaque contexte encapsulé le capture au moment
  // de son enregistrement (piège classique de Fastify, vu en cours).
  app.setErrorHandler((error: import("fastify").FastifyError, request, reply) => {
    if (error.validation) {
      return sendProblem(reply, {
        status: 422,
        family: "validation",
        title: "Erreur de validation",
        detail: "Le corps ou les paramètres de la requête ne respectent pas le contrat.",
        fields: error.validation.map(
          (v: { instancePath?: string; params?: Record<string, unknown>; message?: string }) => ({
            field: String(v.instancePath || v.params?.["missingProperty"] || "body"),
            message: v.message ?? "invalide",
          }),
        ),
      });
    }
    // Les erreurs client de Fastify (JSON mal formé, corps vide avec un
    // Content-Type json, charge trop lourde...) portent un statusCode < 500 :
    // elles ressortent au format RFC 7807 avec leur statut d'origine.
    if (error.statusCode && error.statusCode < 500) {
      return sendProblem(reply, {
        status: error.statusCode,
        family: "invalid-request",
        title: "Requête invalide",
        detail: error.message,
      });
    }
    // Tout le reste est un vrai bug : on le journalise avec sa pile,
    // et l'on répond sobre. Le détail interne ne sort jamais vers le client.
    request.log.error(error);
    return sendProblem(reply, {
      status: 500,
      family: "internal-error",
      title: "Erreur interne",
      detail: "Quelque chose s'est mal passé de notre côté. L'équipe est prévenue par les logs.",
    });
  });

  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(realtimePlugin);

  // Les fichiers uploadés sont servis statiquement sous /media.
  await app.register(fastifyStatic, {
    root: path.resolve(process.env.MEDIA_DIR ?? "./media"),
    prefix: "/media/",
  });

  // Toutes les routes REST vivent sous /v1 : le versionnement par le
  // chemin, simple et lisible. Le jour du /v2, les deux cohabitent.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(adventurerRoutes);
      await v1.register(questRoutes);
      await v1.register(badgeRoutes);
      await v1.register(mediaRoutes);
    },
    { prefix: "/v1" },
  );

  await app.register(codex);

  // Petite route de santé pour Docker et la supervision.
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
