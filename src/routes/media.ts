// =============================================================================
// Route d'upload des photos
// -----------------------------------------------------------------------------
// Le serveur ne fait JAMAIS confiance au Content-Type annoncé : sharp ouvre
// réellement l'image, et c'est lui qui dit ce qu'elle est. Une image valide
// est recompressée en WebP et bornée à 1600 px : ce qui est stocké est
// toujours un fichier que NOUS avons produit, pas celui du client.
// =============================================================================

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { sendProblem } from "../utils/problems.js";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo, comme au contrat
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export default async function mediaRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  });

  const directory = process.env.MEDIA_DIR ?? "./media";
  await mkdir(directory, { recursive: true });

  app.post("/media", { preHandler: app.requireAuth }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return sendProblem(reply, {
        status: 422,
        family: "validation",
        title: "Erreur de validation",
        detail: "Le champ « file » est requis en multipart/form-data.",
      });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      // La limite de taille du plugin multipart a coupé le flux.
      return sendProblem(reply, {
        status: 413,
        family: "file-too-large",
        title: "Fichier trop lourd",
        detail: "5 Mo maximum.",
      });
    }

    // Le verdict vient de l'image elle-même, pas de l'en-tête.
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch {
      metadata = null;
    }
    if (!metadata?.format || !ACCEPTED_FORMATS.has(metadata.format)) {
      return sendProblem(reply, {
        status: 415,
        family: "unsupported-media-type",
        title: "Format non supporté",
        detail: "JPEG, PNG ou WebP uniquement. Le type réel du fichier est vérifié côté serveur.",
      });
    }

    // Recompression systématique : taille bornée, métadonnées EXIF purgées
    // (la géolocalisation d'une photo n'a rien à faire sur un serveur).
    const filename = `${randomUUID()}.webp`;
    const optimized = await sharp(buffer)
      .rotate() // applique l'orientation EXIF avant de la jeter
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    await writeFile(path.join(directory, filename), optimized);

    const base = process.env.PUBLIC_URL ?? "http://localhost:3000";
    return reply.status(201).send({ url: `${base}/media/${filename}` });
  });
}
