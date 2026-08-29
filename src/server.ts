// =============================================================================
// Le point d'entrée : construire l'application et l'écouter
// =============================================================================

import { buildApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();

// host 0.0.0.0 : indispensable dans un conteneur, sinon le serveur
// n'écoute que l'intérieur du conteneur et personne ne le joint.
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Arrêt propre : Docker envoie SIGTERM, on ferme les connexions en cours
// puis la base. Sans ça, les arrêts perdent des requêtes en vol.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, "arrêt du serveur");
    await app.close();
    process.exit(0);
  });
}
