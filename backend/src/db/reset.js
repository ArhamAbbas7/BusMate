// Delete the embedded database and uploaded proofs. Next start re-creates and re-seeds.
import fs from 'node:fs';
import { config } from '../config.js';

if (config.databaseUrl) {
  console.error('DATABASE_URL is set - refusing to reset an external database. Drop it manually if you really mean it.');
  process.exit(1);
}
fs.rmSync(config.pgliteDir, { recursive: true, force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
console.log('Embedded database and uploads deleted. Run "npm run dev" to start fresh with demo data.');
