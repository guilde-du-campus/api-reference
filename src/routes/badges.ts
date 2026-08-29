// =============================================================================
// Route du livre des badges
// =============================================================================

import type { FastifyInstance } from "fastify";

export default async function badgeRoutes(app: FastifyInstance) {
  // --- GET /badges : public, c'est la vitrine de la gamification ------------
  app.get("/badges", async () => {
    const badges = await app.prisma.badge.findMany({ orderBy: { code: "asc" } });
    return badges.map((b) => ({
      code: b.code,
      name: b.name,
      description: b.description,
      icon: b.icon,
      automatic: b.automatic,
    }));
  });
}
