# La Guilde · API de référence

L'implémentation de référence du contrat `../contrat/openapi.yaml` (v1.1). Au S1, elle sert de back-end aux fronts des étudiants. Au S2, son code devient le corrigé maître : c'est le code que les étudiants liront, il est donc écrit pour être lu.

Convention de langue, la règle de la maison : **le code est en anglais** (identifiants, routes, champs, fichiers), **les commentaires sont en français** (ils expliquent, ils enseignent), et les textes destinés aux utilisateurs sont en français.

## Démarrer

Tout l'environnement tient en une commande :

```bash
docker compose up
```

Au premier lancement : PostgreSQL démarre, les migrations s'appliquent, la graine peuple la Guilde (6 aventuriers, 8 quêtes, 7 badges), puis l'API écoute sur `http://localhost:3000`.

Pour développer sans conteneur (base PostgreSQL requise) :

```bash
cp .env.example .env      # puis ajuster DATABASE_URL
npm install
npm run db:migrate         # applique les migrations
npm run db:seed           # plante la graine de démo
npm run dev               # serveur en rechargement automatique
```

## Les comptes de démonstration

Mot de passe commun : `guilde-demo-2026!`

| Pseudo | Email | Rôle |
|---|---|---|
| MaitreMarius | maitre@guilde.local | GUILD_MASTER |
| Lancelot_du_Lag | lancelot@guilde.local | MEMBER |
| Morgane_la_Merge | morgane@guilde.local | MEMBER |
| Perceval_404 | perceval@guilde.local | MEMBER |
| Viviane_Vim | viviane@guilde.local | MEMBER |
| Galaad_du_Gradle | galaad@guilde.local | MEMBER |

## Les points d'entrée

| URL | Quoi |
|---|---|
| `http://localhost:3000/v1/...` | L'API REST du contrat |
| `http://localhost:3000/v1/codex` | Le Codex GraphQL (GraphiQL activé dans le navigateur) |
| `ws://localhost:3000/v1/realtime?token=...` | Les notifications temps réel |
| `http://localhost:3000/media/...` | Les photos uploadées |
| `http://localhost:3000/health` | La route de santé |

## L'architecture du code

```
src/
├── domain/         Les règles du jeu, pures : progression (XP, niveaux),
│                   cycle de vie des quêtes, badges. Zéro dépendance.
├── services/       Les cas d'usage : lecture, règles, écriture en
│                   transaction. Ne connaît pas Fastify.
├── routes/         Les routes REST : validation du schéma, appel du
│                   service, traduction en HTTP. Minces exprès.
├── codex/          Le GraphQL de consultation (mercurius).
├── plugins/        Prisma, JWT, WebSocket : la plomberie partagée.
├── utils/          Erreurs RFC 7807 et sérialisation des ressources.
├── app.ts          L'assemblage de l'application (testable sans port).
└── server.ts       Le point d'entrée qui écoute.
```

Les choix remarquables, tous discutés en cours :

- **Le séquestre en transaction.** La création d'une quête débite l'auteur dans la même transaction (`updateMany` conditionné sur le solde : deux créations simultanées ne passent pas sous zéro). La validation crédite le preneur, attribue l'XP et évalue les badges : tout passe ou rien ne passe.
- **Le cycle de vie en une table.** `src/domain/lifecycle.ts` est la traduction directe du diagramme d'états-transitions du contrat. Les 409 listent les transitions permises, le front s'en sert pour ses boutons.
- **Les erreurs RFC 7807 partout**, y compris les erreurs de validation de schéma et les erreurs client de Fastify (gestionnaire d'erreurs global, posé avant les routes : piège d'encapsulation classique).
- **L'upload qui ne fait pas confiance au client** : sharp ouvre réellement l'image, recompresse en WebP, borne à 1600 px et purge les métadonnées EXIF.
- **Les jetons de rafraîchissement hachés et à rotation**, avec détection de rejeu (un jeton déjà consommé qui revient révoque toutes les sessions).
- **Le WebSocket notifie, le REST fait foi** : les événements partent après le commit, un client déconnecté se resynchronise en re-consultant l'API.

## Vérifier

```bash
npm run typecheck   # TypeScript strict, zéro erreur
npm test            # les tests du domaine (vitest, sans base)
```

## Ce qui attend le S2

Les étudiants reconstruisent cette API en respectant le contrat. Leur front du S1 sert de recette. Le cache Redis et l'observabilité OpenTelemetry arrivent en séance 5 du module back et ne sont volontairement pas dans cette version : la référence colle au périmètre exigé, les extensions restent des extensions.
