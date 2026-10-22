// The REAL Pulse core (shared/core.ts) running in the browser with an in-memory store: powers the one-file preview.
import bcrypt from 'bcryptjs';
import { createCore, type Deps } from '../../shared/core';
import { memoryStore } from '../../shared/store';
import { seedDemo } from '../../shared/seed';
type Fire = (room: string, ev: string, d: unknown) => void;
let boot: Promise<ReturnType<typeof createCore>> | null = null, fire: Fire = () => {}, core: ReturnType<typeof createCore> | null = null;
export const bindBus = (f: Fire) => { fire = f };
const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))), dec = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s))));
const deps = (): Deps => ({
  hash: p => bcrypt.hashSync(p, 4), check: (p, h) => bcrypt.compareSync(p, h),
  sign: (c, kind) => enc({ ...c, typ: kind }), verify: (t, kind) => { try { const c = dec(t); return c.typ === kind ? { sub: c.sub, oid: c.oid, role: c.role, name: c.name } : null } catch { return null } },
  emit: (room, ev, d) => fire(room, ev, d), ai: async () => null, notify: async () => {}, uid: () => crypto.randomUUID(), now: () => Date.now(), rnd: Math.random,
  http: async url => { const s = core?.sim.get('p-demo'), down = !!s && s.until > Date.now() && s.scenario === 'outage' && url.includes('payments'); return { ok: !down, ms: down ? 0 : Math.round(38 + Math.random() * 70) } },
});
export function demoCore() {
  return (boot ||= (async () => {
    const store = memoryStore(), d = deps(); core = createCore(store, d); await seedDemo(store, d, core, 55);
    const tok = (await core.handle({ method: 'POST', path: '/auth/login', body: { email: 'owner@pulse.dev', password: 'Demo@123' } })).body.accessToken;
    for (const [name, url] of [['Checkout API', 'https://api.acme.dev/health'], ['Payments gateway', 'https://payments.acme.dev/ping'], ['Marketing site', 'https://acme.dev']]) await core.handle({ method: 'POST', path: '/p/p-demo/monitors', body: { name, url }, token: tok });
    const safe = (f: () => Promise<unknown>) => () => { f().catch(() => {}) };
    setInterval(safe(() => core!.tick()), 2000); setInterval(safe(() => core!.watchdog()), 4000); setInterval(safe(() => core!.runMonitors()), 20_000);
    return core;
  })());
}
