// =============================================================================
// Plugin Prisma : un seul client pour toute l'application
// -----------------------------------------------------------------------------
// Le client Prisma gère lui-même son pool de connexions : on n'en crée
// qu'un, on le partage via l'instance Fastify, on le ferme proprement
// à l'arrêt du serveur.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(async function pluginPrisma(app: FastifyInstance) {
  const prisma = new PrismaClient();
  await prisma.$connect();

  app.decorate("prisma", prisma);

  // À l'arrêt du serveur, on rend les connexions à PostgreSQL.
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
