# =============================================================================
# La Guilde · Image de l'API
# -----------------------------------------------------------------------------
# Build en deux étages : le premier compile, le second n'embarque que le
# nécessaire. Les images légères et propres sont un sujet de la séance 5
# du module back : ce fichier sert d'exemple de référence.
# =============================================================================

# --- Étage 1 : compilation ---------------------------------------------------
FROM node:22-alpine AS construction
WORKDIR /app

# Les dépendances d'abord, seules : tant que package.json ne change pas,
# Docker réutilise ce calque et npm ci ne retourne pas sur le réseau.
COPY package.json package-lock.json ./
RUN npm ci

# Puis le code, la génération du client Prisma et la compilation.
COPY tsconfig.json ./
COPY prisma ./prisma
COPY codex.graphql ./
COPY src ./src
RUN npx prisma generate && npm run build

# --- Étage 2 : exécution -----------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# On rapporte uniquement ce qui sert à l'exécution.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=construction /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=construction /app/dist ./dist
COPY prisma ./prisma
COPY codex.graphql ./
# Le code source aussi : la graine (prisma/seed.ts) importe src/domain/badges,
# et elle tourne DANS cette image au premier démarrage (docker-compose.yml).
# Sans ce calque, le conteneur boucle sur ERR_MODULE_NOT_FOUND avant même
# de servir la première requête. Vécu en déployant la préprod.
COPY src ./src

EXPOSE 3000
CMD ["node", "dist/server.js"]
