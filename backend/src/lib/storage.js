// Payment proof uploads. Local disk now; replace saveProof/readProofPath with Azure Blob later.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from './http.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

export const proofUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(new HttpError(400, 'Proof must be a JPG, PNG, WEBP image or a PDF.'));
  },
});

/** Absolute path for a stored proof file name, or null if it is missing/unsafe. */
export function proofPath(name) {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  const p = path.join(config.uploadDir, name);
  return fs.existsSync(p) ? p : null;
}
