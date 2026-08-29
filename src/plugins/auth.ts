// =============================================================================
// Plugin d'authentification : JWT et gardiens de routes
// -----------------------------------------------------------------------------
// Deux décorateurs sont exposés :
//  · app.requireAuth : la route refuse quiconque n'a pas de jeton valide
//  · app.requireGuildMaster : en plus, le rôle GUILD_MASTER est requis
// Le contenu du jeton reste minimal : l'id et le rôle. Tout le reste se lit
// en base au besoin : un JWT n'est pas une base de données.
// =============================================================================

import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { forbidden, unauthorized } from "../utils/problems.js";

// Ce que transporte le jeton d'accès, ni plus ni moins.
export interface TokenPayload {
  id: string;
  role: "MEMBER" | "GUILD_MASTER";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireGuildMaster: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
    sign: {
      // 15 minutes : un jeton d'accès qui fuite ne vaut pas cher longtemps.
      expiresIn: "15m",
    },
  });

  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      unauthorized(reply);
    }
  });

  app.decorate("requireGuildMaster", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      unauthorized(reply);
      return;
    }
    if (request.user.role !== "GUILD_MASTER") {
      forbidden(reply, "Cette action est réservée au maître de guilde.");
    }
  });
});
