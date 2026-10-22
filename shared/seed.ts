import type { Store } from './store';
import type { Deps } from './core';
import { createCore } from './core';
import { genEvents, type Scenario } from './simulate';
import { B, bucketT } from './metrics';
export function mulberry(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
export const DEMO_KEY = 'pk_demo_checkout_api';
/** Seeds an org with a live demo project. History is generated step by step and run through the REAL ingest + watchdog, so past incidents are genuine detections. */
export async function seedDemo(store: Store, d: Deps, core: ReturnType<typeof createCore>, historyMin = 55) {
  const now = d.now(), iso = new Date(now).toISOString(), oid = 'o-demo';
  await store.col('orgs').insert({ id: oid, name: 'Acme Labs', createdAt: iso });
  for (const [id, name, email, pw, role] of [['u-owner', 'Aarav (Owner)', 'owner@pulse.dev', 'Demo@123', 'owner'], ['u-viewer', 'Riya (Viewer)', 'viewer@pulse.dev', 'Viewer@123', 'viewer']]) await store.col('users').insert({ id, oid, name, email, hash: d.hash(pw), role, createdAt: iso });
  const p = { id: 'p-demo', oid, name: 'checkout-api', env: 'production', key: DEMO_KEY, sim: true, createdAt: iso };
  await store.col('projects').insert(p); await store.col('projects').insert({ id: 'p-staging', oid, name: 'staging-web', env: 'staging', key: 'pk_demo_staging_web', sim: false, createdAt: iso });
  const r = mulberry(5), start = bucketT(now - historyMin * 60_000), sched = (t: number): Scenario => { const m = (now - t) / 60_000; return m <= 44 && m > 40 ? 'outage' : m <= 22 && m > 18 ? 'slow_db' : 'normal' };
  await core.addDeploy(p.id, 'v1.8.1', 'Checkout: retry payments', start + 3 * 60_000); await core.addDeploy(p.id, 'v1.8.2', 'Search: faster ranking', now - 45 * 60_000);
  for (let t = start; t + B <= now; t += B) { await core.ingest(p, genEvents(sched(t), t, B / 1000, r)); await core.evaluate(p, t + B + 1) }
  core.lastTick.set(p.id, now); // the live simulator continues exactly where the history ends
  return p;
}
