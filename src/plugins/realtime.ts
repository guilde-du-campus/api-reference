// =============================================================================
// Plugin temps réel : le WebSocket des notifications
// -----------------------------------------------------------------------------
// Le serveur pousse des événements ciblés (« ta quête vient d'être prise »).
// Principe important, répété dans le contrat : le WebSocket NOTIFIE, l'API
// REST fait foi. Un client qui rate des événements re-consulte le REST.
//
// L'authentification passe par la query string (?token=...) : après
// l'upgrade HTTP, une connexion WebSocket ne porte plus d'en-têtes.
// =============================================================================

import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { WebSocket } from "ws";
import type { TokenPayload } from "./auth.js";

// Les événements que le serveur peut émettre, tels que décrits au contrat.
export type RealtimeEvent =
  | { event: "quest.taken"; data: { questId: string; title: string; taker: { id: string; username: string } } }
  | { event: "quest.completed"; data: { questId: string; title: string } }
  | { event: "quest.validated"; data: { questId: string; title: string; pointsEarned: number; xpEarned: number } }
  | { event: "badge.awarded"; data: { badgeCode: string; name: string } };

declare module "fastify" {
  interface FastifyInstance {
    notify: (adventurerId: string, event: RealtimeEvent) => void;
  }
}

export default fp(async function realtimePlugin(app: FastifyInstance) {
  await app.register(websocket);

  // Un aventurier peut avoir plusieurs onglets ouverts : on garde une liste
  // de connexions par identifiant.
  const connections = new Map<string, Set<WebSocket>>();

  app.decorate("notify", (adventurerId: string, event: RealtimeEvent) => {
    const sockets = connections.get(adventurerId);
    if (!sockets) return;
    const message = JSON.stringify({ ...event, date: new Date().toISOString() });
    for (const socket of sockets) {
      // readyState 1 = OPEN. On n'écrit jamais sur une connexion fermée.
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  });

  app.get("/v1/realtime", { websocket: true }, (socket, request) => {
    // Le jeton arrive en query string : on le vérifie à la main.
    const { token } = request.query as { token?: string };
    let payload: TokenPayload;
    try {
      payload = app.jwt.verify<TokenPayload>(token ?? "");
    } catch {
      // 4001 : code de fermeture applicatif « non authentifié ».
      socket.close(4001, "Jeton absent ou invalide");
      return;
    }

    // Enregistrement de la connexion...
    let sockets = connections.get(payload.id);
    if (!sockets) {
      sockets = new Set();
      connections.set(payload.id, sockets);
    }
    sockets.add(socket);

    // ... et nettoyage à la fermeture, pour ne pas fuir de la mémoire.
    socket.on("close", () => {
      const set = connections.get(payload.id);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          connections.delete(payload.id);
        }
      }
    });
  });
});
