// =============================================================================
// Erreurs au format RFC 7807 (Problem Details for HTTP APIs)
// -----------------------------------------------------------------------------
// Toutes les erreurs de l'API passent par ici : un seul format, partout.
// Le front peut donc traiter n'importe quelle erreur de la même façon.
// Les identifiants (familles d'erreur) sont en anglais, les textes destinés
// aux utilisateurs sont en français.
// =============================================================================

import type { FastifyReply } from "fastify";

const BASE_TYPE = "https://guilde.sergent.dev/problems";

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  fields?: Array<{ field: string; message: string }>;
}

/** Construit et envoie une erreur RFC 7807. */
export function sendProblem(
  reply: FastifyReply,
  options: { status: number; family: string; title: string; detail: string; fields?: Problem["fields"] },
): FastifyReply {
  const body: Problem = {
    type: `${BASE_TYPE}/${options.family}`,
    title: options.title,
    status: options.status,
    detail: options.detail,
  };
  if (options.fields) {
    body.fields = options.fields;
  }
  return reply
    .status(options.status)
    .header("content-type", "application/problem+json; charset=utf-8")
    .send(body);
}

// Les raccourcis pour les cas qui reviennent tout le temps.

export function unauthorized(reply: FastifyReply, detail = "Jeton absent, invalide ou expiré.") {
  return sendProblem(reply, {
    status: 401,
    family: "unauthorized",
    title: "Non authentifié",
    detail,
  });
}

export function forbidden(reply: FastifyReply, detail: string) {
  return sendProblem(reply, { status: 403, family: "forbidden", title: "Interdit", detail });
}

export function notFound(reply: FastifyReply, detail: string) {
  return sendProblem(reply, {
    status: 404,
    family: "not-found",
    title: "Ressource introuvable",
    detail,
  });
}

export function conflict(reply: FastifyReply, detail: string, family = "conflict") {
  return sendProblem(reply, { status: 409, family, title: "Conflit", detail });
}

export function invalidTransition(reply: FastifyReply, detail: string) {
  return sendProblem(reply, {
    status: 409,
    family: "invalid-transition",
    title: "Transition invalide",
    detail,
  });
}
