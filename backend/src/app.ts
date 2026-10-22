import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import type { createCore } from '../../shared/core';
/** Thin Express adapter: all behaviour lives in shared/core.ts (the same code runs in the in-browser demo). */
export function createApp(core: ReturnType<typeof createCore>) {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), allowedHeaders: ['content-type', 'authorization', 'x-pulse-key'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 100000 : 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again later' } }));
  app.all('/api/*', async (req, res) => {
    const h = req.headers.authorization, bearer = h?.startsWith('Bearer ') ? h.slice(7) : undefined, key = (req.headers['x-pulse-key'] as string | undefined) || (bearer?.startsWith('pk_') ? bearer : undefined);
    const r = await core.handle({ method: req.method, path: req.path.replace(/^\/api/, ''), query: req.query as Record<string, string>, body: req.body, token: key ? undefined : bearer, key });
    res.status(r.status).json(r.body);
  });
  return app;
}
