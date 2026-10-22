import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createCore } from '../../shared/core';
import { memoryStore } from '../../shared/store';
import { seedDemo, mulberry, DEMO_KEY } from '../../shared/seed';
import { genEvents, type Scenario } from '../../shared/simulate';
import { fingerprint, pct, B, EDGES, binOf, emptyHist } from '../../shared/metrics';
import { nodeDeps } from '../src/deps';
import { createApp } from '../src/app';

let T = Date.UTC(2026, 9, 12, 10, 0, 0);
const emitted: { room: string; ev: string }[] = [];
let httpOk = true;
const hooks: { url: string; payload: any }[] = [];
const deps = nodeDeps((room, ev) => { emitted.push({ room, ev }) }, { now: () => T, ai: async () => null, http: async () => ({ ok: httpOk, ms: 42 }), notify: async (url, payload) => { hooks.push({ url, payload }) }, rnd: mulberry(99) });
const store = memoryStore(), core = createCore(store, deps), app = createApp(core), tok: Record<string, string> = {};
const A = (t: string) => ({ Authorization: 'Bearer ' + t });
const proj = async (id: string) => (await store.col('projects').get({ id })) as any;
/** Advance the fake clock, feeding the real ingest + watchdog each 10s step. */
async function run(pid: string, sc: Scenario, minutes: number, seed = 1) {
  const r = mulberry(seed), p = await proj(pid);
  for (let i = 0; i < minutes * 6; i++) { await core.ingest(p, genEvents(sc, T, B / 1000, r)); T += B; await core.evaluate(p, T + 1) }
}
const incidents = async (pid: string) => (await request(app).get(`/api/p/${pid}/incidents`).set(A(tok.owner))).body as any[];
beforeAll(async () => {
  T = Date.UTC(2026, 9, 12, 10, 0, 0); await seedDemo(store, deps, core, 5);
  tok.owner = (await request(app).post('/api/auth/login').send({ email: 'owner@pulse.dev', password: 'Demo@123' })).body.accessToken; tok.viewer = (await request(app).post('/api/auth/login').send({ email: 'viewer@pulse.dev', password: 'Viewer@123' })).body.accessToken;
  await store.col('projects').insert({ id: 'p-t', oid: 'o-demo', name: 'test-app', env: 'test', key: 'pk_test_1', sim: false, createdAt: '' });
});
describe('metrics math', () => {
  it('percentiles come from the histogram', () => { const h = emptyHist(); for (let i = 0; i < 90; i++) h[binOf(30)]++; for (let i = 0; i < 10; i++) h[binOf(900)]++; expect(pct(h, 0.5)).toBeLessThan(50); expect(pct(h, 0.5)).toBeGreaterThan(25); expect(pct(h, 0.99)).toBeGreaterThan(800); expect(EDGES.length + 1).toBe(h.length) });
  it('fingerprints group ids, numbers, urls and quoted strings', () => { const a = fingerprint('Order 1234 failed for user 77 at https://x.io/a?b=1'), b = fingerprint('Order 99 failed for user 5 at https://y.io/zzz'); expect(a.fp).toBe(b.fp); expect(a.fp).not.toBe(fingerprint('Different problem').fp) });
});
describe('auth, roles and tenancy', () => {
  it('signs up an org with a first project and key', async () => { const r = await request(app).post('/api/auth/signup').send({ orgName: 'Other Co', name: 'Zed Owner', email: 'zed@x.com', password: 'Passw0rd!' }); expect(r.status).toBe(200); expect(r.body.project.key).toMatch(/^pk_/); tok.zed = r.body.accessToken; tok.zedProject = r.body.project.id; tok.zedKey = r.body.project.key });
  it('isolates tenants', async () => { expect((await request(app).get('/api/p/p-demo/overview').set(A(tok.zed))).status).toBe(404); expect((await request(app).get('/api/projects').set(A(tok.zed))).body).toHaveLength(1); expect((await request(app).get('/api/team').set(A(tok.zed))).body).toHaveLength(1) });
  it('viewers are read-only and never see API keys', async () => { expect((await request(app).get('/api/projects').set(A(tok.viewer))).body.every((p: any) => p.key === '')).toBe(true); expect((await request(app).post('/api/p/p-demo/rules').set(A(tok.viewer)).send({ name: 'x', metric: 'rps', op: '<', threshold: 1 })).status).toBe(403); expect((await request(app).post('/api/projects').set(A(tok.viewer)).send({ name: 'nope' })).status).toBe(403) });
  it('requires login', async () => { expect((await request(app).get('/api/projects')).status).toBe(401) });
});
describe('ingest API', () => {
  it('rejects missing and wrong keys, accepts valid events and rejects junk', async () => {
    expect((await request(app).post('/api/ingest').send({ events: [] })).status).toBe(401); expect((await request(app).post('/api/ingest').set('x-pulse-key', 'pk_nope').send({ events: [{ type: 'log', level: 'info', message: 'x' }] })).status).toBe(401);
    expect((await request(app).post('/api/ingest').set('x-pulse-key', 'pk_test_1').send({ events: [{ type: 'bogus' }] })).status).toBe(400);
    const ok = await request(app).post('/api/ingest').set('x-pulse-key', 'pk_test_1').send({ events: [{ type: 'request', t: T, method: 'GET', route: '/a', status: 200, ms: 20 }, { type: 'request', t: T, method: 'POST', route: '/a', status: 500, ms: 300 }, { type: 'log', level: 'error', message: 'Job 41 crashed: boom', t: T }, { type: 'log', level: 'error', message: 'Job 977 crashed: boom', t: T }, { type: 'metric', name: 'queue.depth', value: 12, t: T }] });
    expect(ok.body.accepted).toBe(5);
  });
  it('builds buckets, groups errors into issues and exposes live events', async () => {
    const ov = (await request(app).get('/api/p/p-t/overview?minutes=15').set(A(tok.owner))).body; expect(ov.kpis.req).toBe(2); expect(ov.kpis.errRate).toBeCloseTo(0.5); expect(ov.issuesOpen).toBe(2);
    const is = (await request(app).get('/api/p/p-t/issues').set(A(tok.owner))).body, crash = is.find((i: any) => /crashed/.test(i.title)); expect(crash.count).toBe(2); expect(is).toHaveLength(2);
    expect(emitted.some(e => e.room === 'p:p-t' && e.ev === 'live')).toBe(true); expect(emitted.some(e => e.room === 'p:p-t' && e.ev === 'issue')).toBe(true);
    const m = (await request(app).get('/api/p/p-t/metrics?name=queue.depth&minutes=15').set(A(tok.owner))).body; expect(m.custom).toContain('queue.depth');
  });
  it('searches logs and shows issue detail with similar issues', async () => {
    expect((await request(app).get('/api/p/p-t/logs?q=crashed&level=error').set(A(tok.owner))).body.length).toBe(2);
    const is = (await request(app).get('/api/p/p-t/issues').set(A(tok.owner))).body[0], det = (await request(app).get(`/api/p/p-t/issues/${is.id}`).set(A(tok.owner))).body; expect(det.trend).toHaveLength(12); expect(det.source).toBe('local');
  });
  it('reopens a resolved issue as a regression', async () => {
    const is = (await request(app).get('/api/p/p-t/issues').set(A(tok.owner))).body.find((i: any) => /crashed/.test(i.title)); await request(app).patch(`/api/p/p-t/issues/${is.id}`).set(A(tok.owner)).send({ status: 'resolved' });
    await request(app).post('/api/ingest').set('x-pulse-key', 'pk_test_1').send({ events: [{ type: 'log', level: 'error', message: 'Job 5 crashed: boom', t: T }] });
    const again = (await request(app).get(`/api/p/p-t/issues/${is.id}`).set(A(tok.owner))).body.issue; expect(again.status).toBe('open'); expect(again.regressed).toBe(true);
  });
});
describe('AI watchdog (real detection on synthetic traffic)', () => {
  it('raises NO false alarms during 25 minutes of normal traffic', async () => { await run('p-demo', 'normal', 25, 3); expect((await incidents('p-demo')).filter(i => i.status !== 'resolved' || i.startedAt > T - 25 * 60_000)).toHaveLength(0) });
  it('opens an incident on an outage, names the route, links the deploy, then auto-resolves', async () => {
    await core.addDeploy('p-demo', 'v9.9.9', 'bad release', T - 60_000); await run('p-demo', 'outage', 2, 4);
    const open = (await incidents('p-demo')).find(i => i.status === 'open'); expect(open).toBeTruthy(); expect(['critical', 'major']).toContain(open.severity); expect(open.title).toMatch(/Error rate/); expect(open.topRoutes[0].route).toBe('POST /api/checkout'); expect(open.culprit.route).toBe('POST /api/checkout'); expect(open.title).toMatch(/on POST \/api\/checkout/); expect(open.summary).toMatch(/POST \/api\/checkout is failing the most: \d+% of its requests/);
    expect(open.signals.some((s: any) => s.kind === 'error_rate' && s.value > 0.15)).toBe(true); expect(open.summary).toMatch(/Error rate jumped/); expect(open.deploy.version).toBe('v9.9.9'); expect(open.hints.join(' ')).toMatch(/Roll back/); expect(open.topIssues.length).toBeGreaterThan(0);
    await run('p-demo', 'normal', 4, 5); const done = (await incidents('p-demo')).find(i => i.id === open.id); expect(done.status).toBe('resolved'); expect(done.autoResolved).toBe(true); expect(done.timeline.at(-1).text).toMatch(/resolved/);
    expect(emitted.filter(e => e.ev === 'incident').length).toBeGreaterThanOrEqual(2);
  });
  it('detects a latency incident (slow database) without an error spike', async () => { await run('p-demo', 'normal', 3, 6); await run('p-demo', 'slow_db', 2, 7); const inc = (await incidents('p-demo')).find(i => i.status === 'open'); expect(inc).toBeTruthy(); expect(inc.signals.some((s: any) => s.kind === 'latency')).toBe(true); await run('p-demo', 'normal', 4, 8); expect((await incidents('p-demo')).every(i => i.status === 'resolved')).toBe(true) });
  it('detects a traffic cliff', async () => { await run('p-demo', 'normal', 3, 9); const p = await proj('p-demo'); for (let i = 0; i < 6; i++) { T += B; await core.evaluate(p, T + 1) } const inc = (await incidents('p-demo')).find(i => i.status === 'open'); expect(inc?.signals.some((s: any) => s.kind === 'traffic_drop')).toBe(true) });
  it('lets members acknowledge and resolve, but not viewers', async () => {
    const inc = (await incidents('p-demo')).find(i => i.status === 'open'); expect((await request(app).patch(`/api/p/p-demo/incidents/${inc.id}`).set(A(tok.viewer)).send({ status: 'acknowledged' })).status).toBe(403);
    expect((await request(app).patch(`/api/p/p-demo/incidents/${inc.id}`).set(A(tok.owner)).send({ status: 'acknowledged' })).body.status).toBe('acknowledged'); const det = (await request(app).get(`/api/p/p-demo/incidents/${inc.id}`).set(A(tok.owner))).body; expect(det.series.length).toBeGreaterThan(10); expect(det.incident.timeline.length).toBeGreaterThan(1);
    expect((await request(app).patch(`/api/p/p-demo/incidents/${inc.id}`).set(A(tok.owner)).send({ status: 'resolved' })).body.status).toBe('resolved');
  });
  it('finds similar past incidents on the incident page', async () => { await run('p-demo', 'normal', 3, 10); await run('p-demo', 'outage', 2, 11); const open = (await incidents('p-demo')).find(i => i.status === 'open'); const det = (await request(app).get(`/api/p/p-demo/incidents/${open.id}`).set(A(tok.owner))).body; expect(det.similar.length).toBeGreaterThan(0); expect(det.similar[0].incident.status).toBe('resolved') });
});
describe('alert rules, monitors, simulator', () => {
  it('a custom rule opens an incident', async () => { await run('p-demo', 'normal', 5, 12); const r = await request(app).post('/api/p/p-demo/rules').set(A(tok.owner)).send({ name: 'Throughput floor', metric: 'rps', op: '<', threshold: 100, windowBuckets: 3, severity: 'minor' }); expect(r.status).toBe(200); await run('p-demo', 'normal', 1, 13); const inc = (await incidents('p-demo')).find(i => i.status === 'open'); expect(inc.signals.some((s: any) => s.kind === 'rule' && s.label === 'Throughput floor')).toBe(true); expect((await request(app).patch(`/api/p/p-demo/rules/${r.body.id}`).set(A(tok.owner)).send({ threshold: 1 })).body.name).toBe('Throughput floor') });
  it('uptime monitors open an incident after two failures and resolve when back up', async () => {
    const m = await request(app).post('/api/p/p-t/monitors').set(A(tok.owner)).send({ name: 'Prod site', url: 'https://example.com' }); expect(m.body.status).toBe('up'); httpOk = false;
    T += 60_000; await core.runMonitors(T, true); T += 60_000; await core.runMonitors(T, true); const inc = ((await request(app).get('/api/p/p-t/incidents').set(A(tok.owner))).body as any[]).find(i => /Monitor down/.test(i.title)); expect(inc.status).toBe('open');
    httpOk = true; T += 60_000; await core.runMonitors(T, true); expect(((await request(app).get('/api/p/p-t/incidents').set(A(tok.owner))).body as any[]).find(i => i.id === inc.id).status).toBe('resolved');
  });
  it('simulator is limited to demo projects and admins', async () => { expect((await request(app).post('/api/p/p-t/simulate').set(A(tok.owner)).send({ scenario: 'outage' })).status).toBe(400); expect((await request(app).post('/api/p/p-demo/simulate').set(A(tok.viewer)).send({ scenario: 'outage' })).status).toBe(403); const r = await request(app).post('/api/p/p-demo/simulate').set(A(tok.owner)).send({ scenario: 'bad_deploy' }); expect(r.body.scenario).toBe('bad_deploy'); expect(((await request(app).get('/api/p/p-demo/deploys').set(A(tok.owner))).body as any[]).some(x => x.version === 'v1.8.3')).toBe(true) });
  it('serves AI insights and manages the team', async () => { const ai = (await request(app).get('/api/p/p-demo/ai').set(A(tok.owner))).body; expect(ai.health.ai).toMatch(/offline/); expect(ai.insights.length).toBeGreaterThan(1); expect((await request(app).post('/api/team').set(A(tok.owner)).send({ name: 'New Dev', email: 'dev@x.com', password: 'Passw0rd!', role: 'member' })).body.role).toBe('member'); expect((await request(app).get('/api/team').set(A(tok.owner))).body.length).toBe(3) });
});

describe('upgrades found in self-review', () => {
  it('a latency incident does not blame a single route, and says so honestly', async () => {
    await run('p-demo', 'normal', 6, 21); await run('p-demo', 'slow_db', 2, 22); const inc = (await incidents('p-demo')).find(i => i.status === 'open');
    expect(inc.title).toBe('Latency degradation'); expect(inc.summary).toMatch(/not tied to one route/); expect(inc.summary).not.toMatch(/failing the most/); expect(inc.culprit).toBeUndefined(); await run('p-demo', 'normal', 4, 23);
  });
  it('sends Slack-style webhook messages when an incident opens and when it resolves', async () => {
    expect((await request(app).patch('/api/projects/p-demo').set(A(tok.owner)).send({ webhook: 'http://evil.example/x' })).status).toBe(400); expect((await request(app).patch('/api/projects/p-demo').set(A(tok.viewer)).send({ webhook: 'https://hooks.example.com/abc' })).status).toBe(403);
    expect((await request(app).patch('/api/projects/p-demo').set(A(tok.owner)).send({ webhook: 'https://hooks.example.com/abc' })).body.webhook).toBe('https://hooks.example.com/abc'); hooks.length = 0;
    await run('p-demo', 'normal', 3, 24); await run('p-demo', 'outage', 2, 25); await run('p-demo', 'normal', 4, 26);
    const ev = hooks.map(h => h.payload.event), msgs = hooks.map(h => h.payload.text).join('\n'); expect(ev).toContain('opened'); expect(ev).toContain('resolved'); const op = hooks.find(h => h.payload.event === 'opened')!;
    expect(op.url).toBe('https://hooks.example.com/abc'); expect(op.payload.text).toMatch(/^.{1,3} Pulse \| checkout-api \| \[(critical|major|minor)\]/); expect(op.payload.incident.hints.length).toBeGreaterThan(0);
    expect(ev).toContain('escalated'); expect(msgs).toMatch(/Escalated to \[(critical|major)\] Error rate spike on POST \/api\/checkout/);
    expect((await request(app).post('/api/projects/p-demo/webhook-test').set(A(tok.owner))).body.ok).toBe(true); expect(hooks.at(-1)!.payload.event).toBe('test');
    expect((await request(app).get('/api/projects').set(A(tok.viewer))).body.every((p: any) => p.webhook === '')).toBe(true);
  });
  it('simulator catches up after a pause, so there are no artificial gaps in the data', async () => {
    const p = await proj('p-demo'); T += 10_000; await core.tick(T); const before = T; T += 90_000; await core.tick(T);
    const ov = (await request(app).get('/api/p/p-demo/overview?minutes=5').set(A(tok.owner))).body; const filled = ov.series.filter((x: any) => x.t >= before && x.t < T - 10_000);
    expect(filled.length).toBeGreaterThanOrEqual(7); expect(filled.every((x: any) => x.req > 20)).toBe(true); expect(p.sim).toBe(true);
  });
  it('does not cry "traffic drop" right after the Pulse server itself (re)starts', async () => {
    const T0 = T, st = memoryStore(), c2 = createCore(st, nodeDeps(() => {}, { now: () => T, ai: async () => null, notify: async () => {}, rnd: mulberry(3) })); await st.col('projects').insert({ id: 'p-x', oid: 'o', name: 'x', env: 'e', key: 'k', sim: false, createdAt: '' });
    const px = (await st.col('projects').get({ id: 'p-x' })) as any, r = mulberry(4); for (let i = 0; i < 40; i++) { await c2.ingest(px, genEvents('normal', T0 - (40 - i) * B, 10, r)) }
    const list = async () => await st.col('incidents').list({ pid: 'p-x' }); T = T0 + 40_000; await c2.evaluate(px, T); expect(await list()).toHaveLength(0);
    T = T0 + 200_000; await c2.evaluate(px, T); expect((await list())[0]?.signals.some((s: any) => s.kind === 'traffic_drop')).toBe(true);
  });
});
