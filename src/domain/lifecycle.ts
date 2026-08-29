// =============================================================================
// Le domaine · Cycle de vie d'une quête
// -----------------------------------------------------------------------------
// L'implémentation directe du diagramme d'états-transitions du contrat
// (contrat/diagrammes/cycle-vie-quete.mmd). Une seule source de vérité :
// si le diagramme change, ce fichier change, et rien d'autre.
// =============================================================================

import type { QuestStatus } from "@prisma/client";

// Les actions possibles sur une quête, telles qu'exposées par l'API
// (POST /quests/{id}/take, /abandon, /complete, /validate, /cancel).
export type QuestAction = "take" | "abandon" | "complete" | "validate" | "cancel";

// La table des transitions : pour chaque action, l'état de départ exigé
// et l'état d'arrivée. Tout ce qui n'est pas dans cette table est refusé.
const TRANSITIONS: Record<QuestAction, { from: QuestStatus; to: QuestStatus }> = {
  take: { from: "OPEN", to: "IN_PROGRESS" },
  abandon: { from: "IN_PROGRESS", to: "OPEN" },
  complete: { from: "IN_PROGRESS", to: "COMPLETED" },
  validate: { from: "COMPLETED", to: "VALIDATED" },
  cancel: { from: "OPEN", to: "CANCELLED" },
};

/**
 * Vérifie qu'une action est permise depuis le statut actuel.
 * Retourne le statut d'arrivée, ou null si la transition est interdite.
 */
export function transition(current: QuestStatus, action: QuestAction): QuestStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from === current ? rule.to : null;
}

/**
 * Les actions permises depuis un statut donné. Sert deux usages :
 * composer le détail des erreurs 409 (« transitions possibles : ... »),
 * et permettre au front d'afficher les bons boutons.
 */
export function allowedActions(status: QuestStatus): QuestAction[] {
  return (Object.keys(TRANSITIONS) as QuestAction[]).filter(
    (action) => TRANSITIONS[action].from === status,
  );
}
