import type { IngestEvent } from './types';
export type Scenario = 'normal' | 'spike' | 'outage' | 'slow_db' | 'bad_deploy';
export const SCENARIOS: Scenario[] = ['normal', 'spike', 'outage', 'slow_db', 'bad_deploy'];
const ROUTES: [string, string, number, number][] = [['GET', '/api/products', 45, 0.38], ['POST', '/api/checkout', 180, 0.12], ['GET', '/api/users/:id', 35, 0.18], ['POST', '/api/login', 90, 0.1], ['GET', '/api/search', 70, 0.16], ['POST', '/api/upload', 320, 0.06]];
const pick = <T,>(a: [T, number][], r: number) => { let x = r * a.reduce((s, y) => s + y[1], 0); for (const [v, w] of a) { x -= w; if (x <= 0) return v } return a[0][0] };
export const releaseOf = (sc: Scenario) => (sc === 'bad_deploy' ? 'v1.8.3' : 'v1.8.2');
/** Realistic synthetic traffic for `seconds` seconds starting at t. Drives the demo, the seed history and the tests. */
export function genEvents(sc: Scenario, t: number, seconds: number, rnd: () => number): IngestEvent[] {
  const wave = 1 + 0.25 * Math.sin(t / 600_000), mult = sc === 'spike' ? 3.2 : 1, n = Math.round(8 * seconds * mult * wave * (0.85 + 0.3 * rnd())), out: IngestEvent[] = [], release = releaseOf(sc);
  for (let i = 0; i < n; i++) {
    const [method, route, base, ] = pick(ROUTES.map(r => [r, r[3]] as [typeof r, number]), rnd()), ts = t + Math.floor(rnd() * seconds * 1000), checkout = route === '/api/checkout', search = route === '/api/search';
    let errP = 0.008, lat = 1, msg = '';
    if (sc === 'spike') { errP = 0.012; lat = 1.35 }
    if (sc === 'outage') { errP = checkout ? 0.85 : 0.2; lat = checkout ? 5 : 2.2; msg = pick<string>([["TypeError: Cannot read properties of undefined (reading 'id')", 3], ['Error: connect ECONNREFUSED 10.0.2.15:5432 (database)', 4], ['Payment gateway timeout after 30000ms', 2]], rnd()) }
    if (sc === 'slow_db') { errP = 0.03; lat = 6; msg = 'Error: Query timeout exceeded 5000ms' }
    if (sc === 'bad_deploy') { errP = search ? 0.65 : 0.06; lat = 1.1; msg = 'SyntaxError: Unexpected token < in JSON at position 0' }
    const ms = Math.max(3, Math.round(base * lat * Math.exp((rnd() - 0.5) * 0.9))), isErr = rnd() < errP, status = isErr ? (rnd() < 0.85 ? 500 : 503) : rnd() < 0.02 ? (rnd() < 0.5 ? 404 : 401) : rnd() < 0.15 ? 201 : 200;
    out.push({ type: 'request', t: ts, method, route, status, ms, service: 'api', release });
    if (isErr && msg && rnd() < 0.7) out.push({ type: 'log', t: ts, level: 'error', message: `${msg}`, service: 'api', release, meta: { route, ms } });
    else if (rnd() < 0.06) out.push({ type: 'log', t: ts, level: rnd() < 0.2 ? 'warn' : 'info', message: rnd() < 0.2 ? `slow query took ${Math.round(ms * 3)}ms (SELECT * FROM orders)` : `order ${Math.floor(rnd() * 90000 + 10000)} processed for user ${Math.floor(rnd() * 999)}`, service: rnd() < 0.3 ? 'worker' : 'api', release });
  }
  if (rnd() < 0.5) out.push({ type: 'metric', t, name: 'queue.depth', value: Math.round((sc === 'outage' ? 120 : 8) * (0.7 + rnd() * 0.6)) });
  return out;
}
