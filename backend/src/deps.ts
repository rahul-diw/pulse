import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import type { Deps } from '../../shared/core';
export async function aiCall(path: string, body: unknown, ms = 2000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(config.aiUrl + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); return r.ok ? await r.json() : null } catch { return null } finally { clearTimeout(t) }
}
export async function httpCheck(url: string) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000), s = Date.now();
  try { const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'PulseMonitor/1.0' } }); return { ok: r.status < 500, ms: Date.now() - s } } catch { return { ok: false, ms: Date.now() - s } } finally { clearTimeout(t) }
}
export async function notifyWebhook(url: string, payload: unknown) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal }) } catch { /* a broken webhook must never break monitoring */ } finally { clearTimeout(t) }
}
export function nodeDeps(emit: (room: string, ev: string, d: unknown) => void, over: Partial<Deps> = {}): Deps {
  return {
    hash: p => bcrypt.hashSync(p, config.bcryptCost), check: (p, h) => bcrypt.compareSync(p, h),
    sign: (c, kind) => jwt.sign({ oid: c.oid, role: c.role, name: c.name, typ: kind }, config.jwtSecret, { subject: c.sub, expiresIn: kind === 'access' ? '15m' : '7d' }),
    verify: (t, kind) => { try { const c = jwt.verify(t, config.jwtSecret) as any; return c.typ === kind ? { sub: c.sub, oid: c.oid, role: c.role, name: c.name } : null } catch { return null } },
    emit, ai: aiCall, http: httpCheck, notify: notifyWebhook, uid: randomUUID, now: Date.now, rnd: Math.random, ...over,
  };
}
