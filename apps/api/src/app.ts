import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { HttpError, errorHandler } from './lib/errors.js';
import { auditRouter, catalogRouter, orgRouter, overviewRouter, rtcRouter, screenSessionsRouter, usersRouter } from './routes/admin.js';
import { authRouter, wsTicketRouter } from './routes/auth.js';
import { deviceRouter } from './routes/device.js';
import { commandsRouter, devicesRouter, policyRouter } from './routes/devices.js';
import { deviceEnrollRouter, enrollmentsRouter, publicEnrollRouter } from './routes/enrollments.js';

const limit = (perMinute: number) => rateLimit({
  windowMs: 60_000, limit: perMinute, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } }); },
});

export function createApp({ rateLimits = true } = {}) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    // The dev server runs over plain http on the LAN; HSTS is only meaningful behind TLS.
    strictTransportSecurity: config.isProd,
  }));

  // CORS for an explicitly configured dashboard origin only (same-origin needs none).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Headers', 'authorization, content-type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    }
    next();
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const on = (n: number) => (rateLimits ? limit(n) : (_q: Request, _s: Response, nx: NextFunction) => nx());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth/login', on(10));
  app.use('/api/auth/setup', on(10));
  app.use('/api/auth', on(120), authRouter);
  app.use('/api/ws-ticket', on(60), wsTicketRouter);
  app.use('/api/public/enroll', on(30), publicEnrollRouter);
  app.use('/api/device/enroll', on(30), deviceEnrollRouter);
  app.use('/api/device/token', on(30));
  app.use('/api/device', on(600), deviceRouter);
  app.use('/api/permissions', catalogRouter);
  app.use('/api', on(600));
  app.use('/api/overview', overviewRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/enrollments', enrollmentsRouter);
  app.use('/api/commands', commandsRouter);
  app.use('/api/policy', policyRouter);
  app.use('/api/screen-sessions', screenSessionsRouter);
  app.use('/api/rtc', rtcRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/organization', orgRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'No such endpoint')));

  // Serve the built dashboard (SPA) from the same origin in production.
  const dist = config.webDistDir || path.resolve(process.cwd(), '../web/dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
