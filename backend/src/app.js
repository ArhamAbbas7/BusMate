import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './lib/http.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import conductorRoutes from './routes/conductor.js';
import devRoutes from './routes/dev.js';
import publicRoutes from './routes/public.js';

const require = createRequire(import.meta.url);
const leafletDist = path.join(path.dirname(require.resolve('leaflet/package.json')), 'dist');
const interDir = path.dirname(require.resolve('@fontsource-variable/inter/package.json'));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          // Allow plain-http testing on a LAN IP; HTTPS is added by the host (Azure) in production
          'upgrade-insecure-requests': null,
        },
      },
      // Geolocation must stay allowed for the conductor page
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Same-origin by default. Add your frontend origin here if you host it separately later.
  if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '1mb' }));

  // ---- API
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/dev', devRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/conductor', conductorRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` }));

  // ---- Frontend (plain HTML/CSS/JS)
  app.use('/vendor/leaflet', express.static(leafletDist, { maxAge: '7d' }));
  app.use('/vendor/inter', express.static(interDir, { maxAge: '30d' }));
  app.use(express.static(config.frontendDir, { extensions: ['html'], index: 'index.html' }));
  app.use((req, res) => {
    const notFoundPage = path.join(config.frontendDir, '404.html');
    if (fs.existsSync(notFoundPage)) res.status(404).sendFile(notFoundPage);
    else res.status(404).send('Not found');
  });

  app.use(errorHandler);
  return app;
}
