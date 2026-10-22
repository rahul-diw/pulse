import { z, ZodError } from 'zod';
import type { Store } from './store';
import type { Org, User, Project, Bucket, LogDoc, Issue, Incident, Deploy, Monitor, Rule, Claims, Role, IngestEvent, Signal } from './types';
import { B, bucketT, newBucket, addToBucket, pct, fingerprint, tokens, jaccard, emptyHist, mergeHist } from './metrics';
import { grid, windowOf, detect, evalRule, describe, severityOf, PATTERNS } from './watchdog';
import { genEvents, SCENARIOS, type Scenario } from './simulate';

export interface Deps {
  hash(p: string): string; check(p: string, h: string): boolean;
  sign(c: Claims, kind: 'access' | 'refresh'): string; verify(t: string, kind: 'access' | 'refresh'): Claims | null;
  emit(room: string, event: string, data: unknown): void;
  ai(path: string, body: unknown): Promise<any | null>;
  http(url: string): Promise<{ ok: boolean; ms: number }>;
  notify(url: string, payload: unknown): Promise<void>;
  uid(): string; now(): number; rnd(): number;
}
export interface Req { method: string; path: string; query?: Record<string, string>; body?: any; token?: string; key?: string }
export interface Res { status: number; body: any }
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }
function bad(c: number, m: string): never { throw new HttpError(c, m) }
type Ctx = { params: Record<string, string>; q: Record<string, string>; body: any; user: Claims | null; project?: Project };
type Auth = null | 'key' | Role[];
const ALL: Role[] = ['owner', 'admin', 'member', 'viewer'], MEM: Role[] = ['owner', 'admin', 'member'], ADM: Role[] = ['owner', 'admin'], OWN: Role[] = ['owner'];
const pubUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, oid: u.oid });
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request'), t: z.number().optional(), method: z.string().max(10), route: z.string().max(200), status: z.number().int().min(100).max(599), ms: z.number().min(0).max(600000), service: z.string().max(40).optional(), release: z.string().max(40).optional() }),
  z.object({ type: z.literal('log'), t: z.number().optional(), level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']), message: z.string().min(1).max(4000), service: z.string().max(40).optional(), release: z.string().max(40).optional(), meta: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('metric'), t: z.number().optional(), name: z.string().min(1).max(60), value: z.number() }),
]);
const ruleBody = z.object({ name: z.string().min(2).max(60), metric: z.enum(['error_rate', 'p95', 'rps', 'log_errors']), op: z.enum(['>', '<']), threshold: z.number(), windowBuckets: z.number().int().min(1).max(60).default(6), severity: z.enum(['critical', 'major', 'minor']).default('major'), enabled: z.boolean().default(true) });
const summ = (b: Bucket) => ({ t: b.t, req: b.req, err: b.err, rate: b.req / (B / 1000), p50: pct(b.hist, 0.5), p95: pct(b.hist, 0.95), p99: pct(b.hist, 0.99), custom: Object.fromEntries(Object.entries(b.custom).map(([k, v]) => [k, v.sum / v.n])) });

export function createCore(store: Store, d: Deps) {
  const C = { orgs: store.col<Org>('orgs'), users: store.col<User>('users'), projects: store.col<Project>('projects'), buckets: store.col<Bucket>('buckets'), logs: store.col<LogDoc>('logs'), issues: store.col<Issue>('issues'), incidents: store.col<Incident>('incidents'), deploys: store.col<Deploy>('deploys'), monitors: store.col<Monitor>('monitors'), rules: store.col<Rule>('rules') };
  const routes: { m: string; re: RegExp; keys: string[]; auth: Auth; fn: (c: Ctx) => Promise<any> }[] = [];
  const add = (m: string, path: string, auth: Auth, fn: (c: Ctx) => Promise<any>) => { const keys: string[] = []; routes.push({ m, re: new RegExp('^' + path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$'), keys, auth, fn }) };
  const sim = new Map<string, { scenario: Scenario; until: number }>(), locks = new Map<string, Promise<unknown>>(), rate = new Map<string, { w: number; n: number }>(), lastEval = new Map<string, number>(), lastMon = new Map<string, number>(), lastTick = new Map<string, number>(), bootAt = d.now();
  const lock = <T,>(k: string, fn: () => Promise<T>): Promise<T> => { const run = (locks.get(k) || Promise.resolve()).then(fn, fn); locks.set(k, run.catch(() => {})); return run };
  const room = (pid: string) => 'p:' + pid;
  const proj = async (c: Ctx) => (await C.projects.get({ id: c.params.pid, oid: c.user!.oid })) || bad(404, 'Project not found');
  const tokensFor = (u: User) => { const cl: Claims = { sub: u.id, oid: u.oid, role: u.role, name: u.name }; return { user: pubUser(u), accessToken: d.sign(cl, 'access'), refreshToken: d.sign(cl, 'refresh') } };
  const newKey = () => 'pk_' + d.uid().replace(/-/g, '').slice(0, 24);
  /** Tells the project's webhook (Slack, Discord, anything that accepts JSON) when an incident opens or resolves. Never blocks or throws. */
  async function announce(pid: string, inc: Incident, ev: 'opened' | 'escalated' | 'resolved') {
    const p = await C.projects.get({ id: pid }); if (!p?.webhook) return;
    const icon = ev === 'resolved' ? '\u2705' : inc.severity === 'critical' ? '\ud83d\udd34' : inc.severity === 'major' ? '\ud83d\udfe0' : '\ud83d\udfe1';
    d.notify(p.webhook, { text: `${icon} Pulse | ${p.name} | ${ev === 'opened' ? `[${inc.severity}] ${inc.title}` : ev === 'escalated' ? `Escalated to [${inc.severity}] ${inc.title}` : `Resolved: ${inc.title}`}\n${inc.summary}`, event: ev, project: p.name, incident: { id: inc.id, title: inc.title, severity: inc.severity, status: inc.status, summary: inc.summary, startedAt: inc.startedAt, hints: inc.hints } }).catch(() => {});
  }
  const addDeploy = async (pid: string, version: string, note: string, t = d.now()) => { const x: Deploy = { id: d.uid(), pid, version, note, t }; await C.deploys.insert(x); d.emit(room(pid), 'deploy', x); return x };

  /* ---------- ingest: events -> buckets, logs, issues (one project at a time) ---------- */
  function ingest(p: Project, events: IngestEvent[]) {
    return lock(p.id, async () => {
      const now = d.now(), byT = new Map<number, { b: Bucket; fresh: boolean }>(), logs: LogDoc[] = [];
      const bucketFor = async (t: number) => { const bt = bucketT(t); let x = byT.get(bt); if (!x) { const ex = await C.buckets.get({ id: `${p.id}:${bt}` }); x = { b: ex || newBucket(p.id, bt), fresh: !ex }; byT.set(bt, x) } return x.b };
      for (const e of events) {
        const t = Math.min(now + 60_000, Math.max(now - 6 * 3600_000, e.t ?? now)), b = await bucketFor(t); addToBucket(b, e);
        if (e.type === 'log') logs.push({ id: d.uid(), pid: p.id, t, level: e.level, message: e.message, service: e.service || 'app', release: e.release, meta: e.meta });
        else if (e.type === 'request' && e.status >= 500) { logs.push({ id: d.uid(), pid: p.id, t, level: 'error', message: `HTTP ${e.status} ${e.method.toUpperCase()} ${e.route}`, service: e.service || 'app', release: e.release, meta: { ms: e.ms, status: e.status } }); b.logs++; b.errLogs++ }
      }
      for (const { b, fresh } of byT.values()) fresh ? await C.buckets.insert(b) : await C.buckets.update({ id: b.id }, { $set: b });
      const groups = new Map<string, { n: number; first: number; last: number; log: LogDoc; title: string }>();
      for (const l of logs) { if (l.level === 'error' || l.level === 'fatal') { const f = fingerprint(l.message); l.fp = f.fp; const g = groups.get(f.fp) || { n: 0, first: l.t, last: l.t, log: l, title: f.title }; g.n++; g.first = Math.min(g.first, l.t); g.last = Math.max(g.last, l.t); groups.set(f.fp, g) } await C.logs.insert(l) }
      for (const [fp, g] of groups) {
        const ex = await C.issues.get({ pid: p.id, fp });
        if (!ex) { const is: Issue = { id: d.uid(), pid: p.id, fp, title: g.title, level: g.log.level, service: g.log.service, count: g.n, firstSeen: g.first, lastSeen: g.last, status: 'open', sample: { message: g.log.message, meta: g.log.meta } }; await C.issues.insert(is); d.emit(room(p.id), 'issue', is) }
        else await C.issues.update({ id: ex.id }, { $set: { count: ex.count + g.n, lastSeen: Math.max(ex.lastSeen, g.last), status: ex.status === 'resolved' ? 'open' : ex.status, regressed: ex.status === 'resolved' ? true : ex.regressed } });
      }
      const last = [...byT.values()].map(x => x.b).sort((a, b) => a.t - b.t).slice(-2);
      if (logs.length || last.length) d.emit(room(p.id), 'live', { logs: logs.slice(-40).map(l => ({ ...l })), buckets: last.map(summ) });
      return { accepted: events.length };
    });
  }

  /* ---------- watchdog: detect, open / update / auto-resolve incidents ---------- */
  /** What is going on right now: worst routes, most frequent errors and a recent deploy. Recomputed while an incident is open, so its story improves as evidence arrives. */
  async function context(p: Project, all: (Bucket | null)[], endT: number, nowMs: number) {
    const win = all.slice(-6).filter(Boolean) as Bucket[], routeMap = new Map<string, { req: number; err: number }>();
    win.forEach(b => Object.entries(b.routes).forEach(([k, v]) => { const x = routeMap.get(k) || { req: 0, err: 0 }; x.req += v.req; x.err += v.err; routeMap.set(k, x) }));
    const topRoutes = [...routeMap].map(([route, v]) => ({ route, ...v })).sort((a, b) => b.err - a.err || b.req - a.req).slice(0, 3);
    const recent = await C.logs.list({ pid: p.id, level: { $in: ['error', 'fatal'] }, t: { $gte: endT - 6 * B } }, { limit: 800 }), cnt = new Map<string, number>(); recent.forEach(l => l.fp && cnt.set(l.fp, (cnt.get(l.fp) || 0) + 1));
    const topIssues: Incident['topIssues'] = []; for (const [fp, n] of [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 5)) { const is = await C.issues.get({ pid: p.id, fp }); if (is) topIssues.push({ issueId: is.id, title: is.title, count: n }) }
    topIssues.sort((a, b) => Number(/^HTTP <n>/.test(a.title)) - Number(/^HTTP <n>/.test(b.title)) || b.count - a.count); topIssues.length = Math.min(3, topIssues.length); // a real error message is more useful than a generic status line
    const dep = (await C.deploys.list({ pid: p.id, t: { $gte: nowMs - 20 * 60_000 } }, { sort: { t: -1 }, limit: 1 }))[0];
    const totReq = [...routeMap.values()].reduce((a, v) => a + v.req, 0), totErr = [...routeMap.values()].reduce((a, v) => a + v.err, 0), overall = totReq ? totErr / totReq : 0;
    // the culprit is the route whose OWN error rate is far above the overall rate (not merely the busiest route)
    const cand = [...routeMap].map(([route, v]) => ({ route, errRate: v.req ? v.err / v.req : 0, req: v.req, err: v.err })).filter(x => x.req >= 15 && x.err >= 8).sort((a, b) => b.errRate - a.errRate)[0];
    const culprit = cand && ((routeMap.size === 1 && cand.errRate >= 0.1) || cand.errRate >= Math.max(0.1, 2.5 * overall)) ? { route: cand.route, errRate: cand.errRate, overall } : undefined;
    return { topRoutes, topIssues, culprit, deploy: dep ? { version: dep.version, minsBefore: Math.max(0, Math.round((nowMs - dep.t) / 60_000)) } : undefined };
  }
  const titleOf = (sig: Signal[], culprit?: { route: string }) => {
    const main = (['error_rate', 'traffic_drop', 'latency', 'rule'] as const).map(k => sig.find(s => s.kind === k)).find(Boolean)!;
    return (main.kind === 'error_rate' ? 'Error rate spike' : main.kind === 'latency' ? 'Latency degradation' : main.kind === 'traffic_drop' ? 'Traffic drop' : `Alert: ${main.label}`) + (culprit && main.kind === 'error_rate' ? ` on ${culprit.route}` : '');
  };
  async function evaluate(p: Project, nowMs = d.now()) {
    const endT = bucketT(nowMs), bs = await C.buckets.list({ pid: p.id, t: { $gte: endT - 63 * B, $lt: endT } }), all = grid(bs, endT, 63);
    const sig: Signal[] = detect(all).filter(s => s.kind !== 'traffic_drop' || nowMs - bootAt >= 90_000), rules = await C.rules.list({ pid: p.id, enabled: true });
    for (const r of rules) { const s = evalRule(r, all); if (s) sig.push(s) }
    const open = await C.incidents.get({ pid: p.id, source: 'watchdog', status: { $in: ['open', 'acknowledged'] } }), w = windowOf(all.slice(-3)), base = windowOf(all.slice(0, -3));
    if (sig.length) {
      const ctx = await context(p, all, endT, nowMs);
      if (!open) {
        const ml = await d.ai('/anomaly', { series: all.map(b => ({ req: b?.req || 0, err: b?.err || 0, p95: b ? pct(b.hist, 0.95) : 0 })) });
        const inc: Incident = { id: d.uid(), pid: p.id, source: 'watchdog', title: titleOf(sig, ctx.culprit), severity: severityOf(sig), status: 'open', startedAt: nowMs, lastSignalAt: nowMs, quietBuckets: 0, signals: sig, summary: '', hints: [], timeline: [{ t: nowMs, text: 'Pulse detected an anomaly and opened this incident automatically.' }], ...ctx, peak: { errRate: w.errRate, p95: w.p95 }, baseline: { errRate: base.errRate, p95: base.p95 }, ml: ml?.score ?? undefined };
        Object.assign(inc, describe(inc)); await C.incidents.insert(inc); d.emit(room(p.id), 'incident', inc); await announce(p.id, inc, 'opened'); return inc;
      }
      const kinds = new Set(open.signals.map(s => s.kind + (s.ruleId || ''))), merged = [...open.signals, ...sig.filter(s => !kinds.has(s.kind + (s.ruleId || '')))].map(s => { const n = sig.find(x => x.kind === s.kind && x.ruleId === s.ruleId); return n && n.z > s.z ? n : s });
      const peak = { errRate: Math.max(open.peak.errRate, w.errRate), p95: Math.max(open.peak.p95, w.p95) }, grown = { ...ctx, signals: merged, peak, baseline: open.baseline }, desc = describe(grown);
      const rank = { minor: 0, major: 1, critical: 2 }, escalated = rank[severityOf(merged)] > rank[open.severity];
      const u = await C.incidents.update({ id: open.id }, { $set: { lastSignalAt: nowMs, quietBuckets: 0, signals: merged, peak, severity: severityOf(merged), title: titleOf(merged, ctx.culprit), summary: desc.summary, hints: desc.hints, culprit: ctx.culprit, topRoutes: ctx.topRoutes, topIssues: ctx.topIssues, deploy: ctx.deploy || open.deploy } }); u && d.emit(room(p.id), 'incident', u); if (u && escalated) await announce(p.id, u, 'escalated'); return u;
    }
    if (open) {
      const q = open.quietBuckets + 1;
      if (q >= 6) { const u = await C.incidents.update({ id: open.id }, { $set: { status: 'resolved', resolvedAt: nowMs, autoResolved: true, quietBuckets: q }, $push: { timeline: { t: nowMs, text: 'Metrics are back to normal. Pulse resolved this incident automatically.' } } }); u && d.emit(room(p.id), 'incident', u); if (u) await announce(p.id, u, 'resolved'); return u }
      await C.incidents.update({ id: open.id }, { $set: { quietBuckets: q } });
    }
    return null;
  }
  async function watchdog(nowMs = d.now()) { for (const p of await C.projects.list()) { const bt = bucketT(nowMs); if (lastEval.get(p.id) === bt) continue; lastEval.set(p.id, bt); await evaluate(p, nowMs) } }
  /** Synthetic traffic for demo projects. Catches up after pauses (background tabs, restarts) so there are never artificial gaps. */
  async function tick(nowMs = d.now()) { for (const p of (await C.projects.list({ sim: true }))) { let s = sim.get(p.id); if (s && s.until < nowMs) { sim.delete(p.id); s = undefined } const gap = Math.min(180_000, Math.max(2000, nowMs - (lastTick.get(p.id) ?? nowMs - 2000))); lastTick.set(p.id, nowMs); await ingest(p, genEvents(s?.scenario || 'normal', nowMs - gap, gap / 1000, d.rnd)) } }
  async function runMonitors(nowMs = d.now(), force = false) {
    for (const m of await C.monitors.list()) {
      if (!force && nowMs - (lastMon.get(m.id) || 0) < 55_000) continue; lastMon.set(m.id, nowMs);
      const r = await d.http(m.url).catch(() => ({ ok: false, ms: 0 })), checks = [...m.checks, { t: nowMs, ok: r.ok, ms: r.ms }].slice(-60), down = checks.length >= 2 && !checks[checks.length - 1].ok && !checks[checks.length - 2].ok, status: Monitor['status'] = r.ok ? 'up' : down ? 'down' : m.status;
      const u = await C.monitors.update({ id: m.id }, { $set: { checks, status, lastMs: r.ms, lastCheck: nowMs } }); u && d.emit(room(m.pid), 'monitor', u);
      const open = await C.incidents.get({ pid: m.pid, status: { $in: ['open', 'acknowledged'] }, title: `Monitor down: ${m.name}` });
      if (status === 'down' && !open) { const sg: Signal = { kind: 'rule', value: 0, baseline: 1, z: 0, label: `Monitor "${m.name}" is down` }; const inc: Incident = { id: d.uid(), pid: m.pid, source: 'monitor', title: `Monitor down: ${m.name}`, severity: 'critical', status: 'open', startedAt: nowMs, lastSignalAt: nowMs, quietBuckets: 0, signals: [sg], summary: `${m.url} failed 2 checks in a row.`, hints: ['Check the server, DNS and TLS certificate, then the deploy log.'], timeline: [{ t: nowMs, text: 'Uptime monitor failed twice in a row.' }], topRoutes: [], topIssues: [], peak: { errRate: 0, p95: 0 }, baseline: { errRate: 0, p95: 0 } }; await C.incidents.insert(inc); d.emit(room(m.pid), 'incident', inc); await announce(m.pid, inc, 'opened') }
      if (status === 'up' && open) { const u2 = await C.incidents.update({ id: open.id }, { $set: { status: 'resolved', resolvedAt: nowMs, autoResolved: true }, $push: { timeline: { t: nowMs, text: 'Monitor is responding again.' } } }); u2 && d.emit(room(m.pid), 'incident', u2); if (u2) await announce(m.pid, u2, 'resolved') }
    }
  }
  async function cleanup(nowMs = d.now()) { const cut = nowMs - 24 * 3600_000; for (const b of await C.buckets.list({ t: { $lt: cut } }, { limit: 400 })) await C.buckets.remove({ id: b.id }); for (const l of await C.logs.list({ t: { $lt: cut } }, { limit: 400 })) await C.logs.remove({ id: l.id }) }

  /* ---------- public ---------- */
  add('GET', '/health', null, async () => ({ status: 'ok', time: new Date(d.now()).toISOString() }));
  add('POST', '/ingest', 'key', async c => {
    const p = c.project!, { events } = z.object({ events: z.array(eventSchema).min(1).max(500) }).parse(c.body), w = Math.floor(d.now() / 60_000), r = rate.get(p.id);
    if (r && r.w === w) { r.n += events.length; if (r.n > 30000) bad(429, 'Rate limit exceeded for this project (30,000 events/minute)') } else rate.set(p.id, { w, n: events.length });
    return ingest(p, events as IngestEvent[]);
  });
  add('POST', '/ingest/deploy', 'key', async c => { const b = z.object({ version: z.string().min(1).max(40), note: z.string().max(200).default('') }).parse(c.body); return addDeploy(c.project!.id, b.version, b.note) });

  /* ---------- auth ---------- */
  add('POST', '/auth/signup', null, async c => {
    const b = z.object({ orgName: z.string().min(2).max(60), name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100) }).parse(c.body), email = b.email.toLowerCase();
    if (await C.users.get({ email })) bad(409, 'An account with this email already exists');
    const now = new Date(d.now()).toISOString(), oid = 'o' + d.uid().slice(0, 8), u: User = { id: d.uid(), oid, name: b.name, email, hash: d.hash(b.password), role: 'owner', createdAt: now };
    await C.orgs.insert({ id: oid, name: b.orgName, createdAt: now }); await C.users.insert(u);
    const p: Project = { id: 'p' + d.uid().slice(0, 8), oid, name: 'my-first-app', env: 'production', key: newKey(), sim: false, createdAt: now }; await C.projects.insert(p);
    return { ...tokensFor(u), project: p };
  });
  add('POST', '/auth/login', null, async c => { const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(c.body), u = await C.users.get({ email: b.email.toLowerCase() }); if (!u || !d.check(b.password, u.hash)) bad(401, 'Invalid email or password'); return tokensFor(u) });
  add('POST', '/auth/refresh', null, async c => { const { refreshToken } = z.object({ refreshToken: z.string() }).parse(c.body), cl = d.verify(refreshToken, 'refresh'), u = cl && (await C.users.get({ id: cl.sub })); if (!u) bad(401, 'Session expired'); return { accessToken: d.sign({ sub: u.id, oid: u.oid, role: u.role, name: u.name }, 'access') } });
  add('GET', '/auth/me', ALL, async c => { const u = (await C.users.get({ id: c.user!.sub })) || bad(404, 'Not found'), o = await C.orgs.get({ id: u.oid }); return { user: pubUser(u), org: o } });

  /* ---------- projects ---------- */
  const withState = (p: Project) => ({ ...p, scenario: sim.get(p.id) && sim.get(p.id)!.until > d.now() ? sim.get(p.id)!.scenario : 'normal' });
  add('GET', '/projects', ALL, async c => (await C.projects.list({ oid: c.user!.oid }, { sort: { createdAt: 1 } })).map(p => (c.user!.role === 'viewer' ? { ...withState(p), key: '', webhook: '' } : withState(p))));
  add('POST', '/projects', ADM, async c => { const b = z.object({ name: z.string().min(2).max(40), env: z.string().max(20).default('production') }).parse(c.body), p: Project = { id: 'p' + d.uid().slice(0, 8), oid: c.user!.oid, name: b.name, env: b.env, key: newKey(), sim: false, createdAt: new Date(d.now()).toISOString() }; await C.projects.insert(p); return p });
  add('PATCH', '/projects/:pid', ADM, async c => { const p = await proj(c), b = z.object({ name: z.string().min(2).max(40), env: z.string().max(20), webhook: z.string().max(500).refine(v => v === '' || /^https:\/\//.test(v) || /^http:\/\/localhost/.test(v), 'Webhook must be an https:// URL') }).partial().parse(c.body), set = Object.fromEntries(Object.entries(b).filter(([k]) => k in c.body)); return C.projects.update({ id: p.id }, { $set: set }) });
  add('POST', '/projects/:pid/webhook-test', ADM, async c => { const p = await proj(c); if (!p.webhook) bad(400, 'Set a webhook URL first'); await d.notify(p.webhook, { text: `\u2705 Pulse | ${p.name} | Test notification. Incident alerts will arrive here.`, event: 'test', project: p.name }); return { ok: true } });
  add('POST', '/projects/:pid/rotate-key', ADM, async c => { const p = await proj(c); return C.projects.update({ id: p.id }, { $set: { key: newKey() } }) });
  add('DELETE', '/projects/:pid', OWN, async c => { const p = await proj(c); await C.projects.remove({ id: p.id }); return { ok: true } });
  add('POST', '/p/:pid/simulate', ADM, async c => {
    const p = await proj(c), { scenario } = z.object({ scenario: z.enum(SCENARIOS as [Scenario, ...Scenario[]]) }).parse(c.body); if (!p.sim) bad(400, 'Traffic simulation is only available on demo projects');
    if (scenario === 'normal') sim.delete(p.id); else sim.set(p.id, { scenario, until: d.now() + 150_000 }); if (scenario === 'bad_deploy') await addDeploy(p.id, 'v1.8.3', 'Search: new response parser');
    d.emit(room(p.id), 'scenario', { scenario }); return { scenario, seconds: scenario === 'normal' ? 0 : 150 };
  });

  /* ---------- dashboards ---------- */
  add('GET', '/p/:pid/overview', ALL, async c => {
    const p = await proj(c), minutes = Math.min(180, Math.max(5, +(c.q.minutes || 15))), n = Math.ceil((minutes * 60_000) / B), endT = bucketT(d.now()) + B;
    const bs = await C.buckets.list({ pid: p.id, t: { $gte: endT - 2 * n * B, $lt: endT } }), all = grid(bs, endT, 2 * n), cur = all.slice(n), prev = all.slice(0, n);
    const series = cur.map((b, i) => ({ t: endT - (n - i) * B, req: b?.req || 0, err: b?.err || 0, rate: (b?.req || 0) / (B / 1000), p50: b ? pct(b.hist, 0.5) : 0, p95: b ? pct(b.hist, 0.95) : 0, p99: b ? pct(b.hist, 0.99) : 0 }));
    const rm = new Map<string, { req: number; err: number; latSum: number }>(); cur.forEach(b => b && Object.entries(b.routes).forEach(([k, v]) => { const x = rm.get(k) || { req: 0, err: 0, latSum: 0 }; x.req += v.req; x.err += v.err; x.latSum += v.latSum; rm.set(k, x) }));
    const wc = windowOf(cur), wp = windowOf(prev), openInc = await C.incidents.list({ pid: p.id, status: { $in: ['open', 'acknowledged'] } }), mons = await C.monitors.list({ pid: p.id });
    return { project: withState(p), minutes, series, kpis: { rps: wc.rate, errRate: wc.errRate, p95: wc.p95, req: wc.req, prev: { rps: wp.rate, errRate: wp.errRate, p95: wp.p95, req: wp.req } }, routes: [...rm].map(([route, v]) => ({ route, req: v.req, err: v.err, avgMs: v.req ? v.latSum / v.req : 0 })).sort((a, b) => b.req - a.req).slice(0, 8), deploys: await C.deploys.list({ pid: p.id, t: { $gte: endT - n * B } }), openIncidents: openInc, issuesOpen: await C.issues.count({ pid: p.id, status: 'open' }), monitors: { up: mons.filter(m => m.status === 'up').length, total: mons.length } };
  });
  add('GET', '/p/:pid/logs', ALL, async c => {
    const p = await proj(c), f: any = { pid: p.id }; if (c.q.level) f.level = { $in: c.q.level.split(',') }; if (c.q.service) f.service = c.q.service;
    if (c.q.q) f.message = { $regex: c.q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    return C.logs.list(f, { sort: { t: -1 }, limit: Math.min(300, +(c.q.limit || 100)) });
  });
  add('GET', '/p/:pid/metrics', ALL, async c => {
    const p = await proj(c), minutes = Math.min(1440, Math.max(5, +(c.q.minutes || 60))), name = c.q.name || 'rps', step = Math.max(1, Math.ceil((minutes * 60_000) / B / 180)), n = Math.ceil((minutes * 60_000) / B), endT = bucketT(d.now()) + B;
    const g = grid(await C.buckets.list({ pid: p.id, t: { $gte: endT - n * B, $lt: endT } }), endT, n), out: { t: number; v: number }[] = [];
    for (let i = 0; i < n; i += step) { const chunk = g.slice(i, i + step), w = windowOf(chunk); let v = 0; if (name === 'rps') v = w.rate; else if (name === 'error_rate') v = w.errRate * 100; else if (name === 'p95') v = w.p95; else if (name === 'p50' || name === 'p99') { let h = emptyHist(); chunk.forEach(b => { if (b) h = mergeHist(h, b.hist) }); v = pct(h, name === 'p50' ? 0.5 : 0.99) } else { let s = 0, k = 0; chunk.forEach(b => { const x = b?.custom[name]; if (x) { s += x.sum; k += x.n } }); v = k ? s / k : 0 } out.push({ t: endT - (n - i) * B, v }) }
    const names = new Set<string>(); g.forEach(b => b && Object.keys(b.custom).forEach(k => names.add(k)));
    return { name, minutes, points: out, custom: [...names], deploys: await C.deploys.list({ pid: p.id, t: { $gte: endT - n * B } }) };
  });

  /* ---------- issues ---------- */
  add('GET', '/p/:pid/issues', ALL, async c => { const p = await proj(c); return C.issues.list({ pid: p.id, ...(c.q.status ? { status: c.q.status } : {}) }, { sort: { lastSeen: -1 }, limit: 200 }) });
  add('GET', '/p/:pid/issues/:iid', ALL, async c => {
    const p = await proj(c), is = (await C.issues.get({ id: c.params.iid, pid: p.id })) || bad(404, 'Issue not found'), now = d.now(), logs = await C.logs.list({ pid: p.id, fp: is.fp, t: { $gte: now - 3600_000 } }, { sort: { t: -1 }, limit: 2000 });
    const trend = Array.from({ length: 12 }, (_, i) => ({ t: now - (12 - i) * 300_000, n: logs.filter(l => l.t >= now - (12 - i) * 300_000 && l.t < now - (11 - i) * 300_000).length }));
    const others = (await C.issues.list({ pid: p.id }, { limit: 300 })).filter(x => x.id !== is.id), ai = await d.ai('/similar', { query: is.title, docs: others.map(x => ({ id: x.id, text: x.title })), k: 4 }), tk = tokens(is.title);
    const sim2 = ai?.similar ? ai.similar.map((s: any) => ({ issue: others.find(x => x.id === s.id)!, score: s.score })) : others.map(x => ({ issue: x, score: jaccard(tk, tokens(x.title)) })).sort((a, b) => b.score - a.score).slice(0, 4);
    return { issue: is, trend, samples: logs.slice(0, 6), similar: sim2.filter((s: any) => s.issue && s.score > 0.05), hints: PATTERNS.filter(([re]) => re.test(is.title + ' ' + is.sample.message)).map(x => x[1]), source: ai ? 'python' : 'local' };
  });
  add('PATCH', '/p/:pid/issues/:iid', MEM, async c => { const p = await proj(c), { status } = z.object({ status: z.enum(['open', 'resolved', 'ignored']) }).parse(c.body), u = await C.issues.update({ id: c.params.iid, pid: p.id }, { $set: { status, regressed: false } }); return u || bad(404, 'Issue not found') });

  /* ---------- incidents ---------- */
  add('GET', '/p/:pid/incidents', ALL, async c => { const p = await proj(c); return C.incidents.list({ pid: p.id }, { sort: { startedAt: -1 }, limit: 100 }) });
  add('GET', '/p/:pid/incidents/:id', ALL, async c => {
    const p = await proj(c), inc = (await C.incidents.get({ id: c.params.id, pid: p.id })) || bad(404, 'Incident not found'), end = (inc.resolvedAt || d.now()) + 5 * 60_000, from = inc.startedAt - 15 * 60_000, n = Math.min(240, Math.ceil((end - from) / B)), endT = bucketT(end) + B;
    const g = grid(await C.buckets.list({ pid: p.id, t: { $gte: endT - n * B, $lt: endT } }), endT, n), series = g.map((b, i) => ({ t: endT - (n - i) * B, req: b?.req || 0, err: b?.err || 0, rate: (b?.req || 0) / (B / 1000), p95: b ? pct(b.hist, 0.95) : 0, errRate: b && b.req ? b.err / b.req : 0 }));
    const tags = (x: Incident) => new Set([...x.signals.map(s => s.kind), ...x.topRoutes.map(r => r.route), ...x.topIssues.map(i => i.title)]), me = tags(inc);
    const past = (await C.incidents.list({ pid: p.id, status: 'resolved' }, { limit: 100 })).filter(x => x.id !== inc.id).map(x => ({ incident: x, score: jaccard(me, tags(x)) })).filter(x => x.score > 0.15).sort((a, b) => b.score - a.score).slice(0, 3);
    return { incident: inc, series, deploys: await C.deploys.list({ pid: p.id, t: { $gte: from, $lt: end } }), logs: await C.logs.list({ pid: p.id, level: { $in: ['error', 'fatal'] }, t: { $gte: inc.startedAt - 30_000, $lt: end } }, { sort: { t: -1 }, limit: 12 }), similar: past };
  });
  add('PATCH', '/p/:pid/incidents/:id', MEM, async c => {
    const p = await proj(c), { status } = z.object({ status: z.enum(['acknowledged', 'resolved']) }).parse(c.body), now = d.now();
    const u = await C.incidents.update({ id: c.params.id, pid: p.id }, { $set: status === 'resolved' ? { status, resolvedAt: now } : { status }, $push: { timeline: { t: now, text: `${c.user!.name} ${status === 'resolved' ? 'resolved' : 'acknowledged'} the incident.` } } });
    if (!u) bad(404, 'Incident not found'); d.emit(room(p.id), 'incident', u); if (status === 'resolved') await announce(p.id, u, 'resolved'); return u;
  });

  /* ---------- monitors, rules, deploys, team, ai ---------- */
  add('GET', '/p/:pid/monitors', ALL, async c => C.monitors.list({ pid: (await proj(c)).id }));
  add('POST', '/p/:pid/monitors', ADM, async c => { const p = await proj(c), b = z.object({ name: z.string().min(2).max(40), url: z.string().url().max(300) }).parse(c.body), m: Monitor = { id: d.uid(), pid: p.id, ...b, status: 'unknown', lastMs: 0, lastCheck: 0, checks: [] }; await C.monitors.insert(m); await runMonitors(d.now(), true); return (await C.monitors.get({ id: m.id })) || m });
  add('DELETE', '/p/:pid/monitors/:mid', ADM, async c => { const p = await proj(c); return (await C.monitors.remove({ id: c.params.mid, pid: p.id })) ? { ok: true } : bad(404, 'Monitor not found') });
  add('POST', '/p/:pid/monitors-run', ADM, async c => { await proj(c); await runMonitors(d.now(), true); return { ok: true } });
  add('GET', '/p/:pid/rules', ALL, async c => C.rules.list({ pid: (await proj(c)).id }));
  add('POST', '/p/:pid/rules', ADM, async c => { const p = await proj(c), r: Rule = { id: d.uid(), pid: p.id, ...ruleBody.parse(c.body) }; await C.rules.insert(r); return r });
  add('PATCH', '/p/:pid/rules/:rid', ADM, async c => { const p = await proj(c), b = ruleBody.partial().parse(c.body), set = Object.fromEntries(Object.entries(b).filter(([k]) => k in c.body)); return (await C.rules.update({ id: c.params.rid, pid: p.id }, { $set: set })) || bad(404, 'Rule not found') });
  add('DELETE', '/p/:pid/rules/:rid', ADM, async c => { const p = await proj(c); return (await C.rules.remove({ id: c.params.rid, pid: p.id })) ? { ok: true } : bad(404, 'Rule not found') });
  add('GET', '/p/:pid/deploys', ALL, async c => C.deploys.list({ pid: (await proj(c)).id }, { sort: { t: -1 }, limit: 50 }));
  add('POST', '/p/:pid/deploys', ADM, async c => { const p = await proj(c), b = z.object({ version: z.string().min(1).max(40), note: z.string().max(200).default('') }).parse(c.body); return addDeploy(p.id, b.version, b.note) });
  add('GET', '/team', ALL, async c => (await C.users.list({ oid: c.user!.oid })).map(pubUser));
  add('POST', '/team', ADM, async c => { const b = z.object({ name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100), role: z.enum(['admin', 'member', 'viewer']) }).parse(c.body), email = b.email.toLowerCase(); if (await C.users.get({ email })) bad(409, 'Email already in use'); const u: User = { id: d.uid(), oid: c.user!.oid, name: b.name, email, hash: d.hash(b.password), role: b.role, createdAt: new Date(d.now()).toISOString() }; await C.users.insert(u); return pubUser(u) });
  add('DELETE', '/team/:id', OWN, async c => { if (c.params.id === c.user!.sub) bad(409, 'You cannot remove yourself'); return (await C.users.remove({ id: c.params.id, oid: c.user!.oid })) ? { ok: true } : bad(404, 'Member not found') });
  add('GET', '/p/:pid/ai', ALL, async c => {
    const p = await proj(c), now = d.now(), endT = bucketT(now), g = grid(await C.buckets.list({ pid: p.id, t: { $gte: endT - 360 * B, $lt: endT } }), endT, 360), h = windowOf(g), prevH = windowOf(g.slice(0, 180)), curH = windowOf(g.slice(180)), ai = await d.ai('/health', null), insights: string[] = [];
    if (h.req) insights.push(`Availability over the last hour: ${(100 - curH.errRate * 100).toFixed(2)}% of ${curH.req.toLocaleString()} requests succeeded.`);
    if (prevH.p95 && curH.p95) insights.push(`p95 latency is ${curH.p95 > prevH.p95 * 1.15 ? 'up' : curH.p95 < prevH.p95 * 0.85 ? 'down' : 'steady'} versus the previous hour (${Math.round(prevH.p95)}ms now, ${Math.round(prevH.p95)}ms before).`.replace(`${Math.round(prevH.p95)}ms now`, `${Math.round(curH.p95)}ms now`));
    const rm = new Map<string, { req: number; latSum: number }>(); g.slice(180).forEach(b => b && Object.entries(b.routes).forEach(([k, v]) => { const x = rm.get(k) || { req: 0, latSum: 0 }; x.req += v.req; x.latSum += v.latSum; rm.set(k, x) }));
    const slow = [...rm].filter(([, v]) => v.req >= 50).map(([k, v]) => ({ k, ms: v.latSum / v.req })).sort((a, b) => b.ms - a.ms)[0]; if (slow) insights.push(`Slowest route: ${slow.k} averaging ${Math.round(slow.ms)}ms.`);
    const noisy = (await C.issues.list({ pid: p.id, status: 'open' }, { sort: { count: -1 }, limit: 1 }))[0]; if (noisy) insights.push(`Noisiest open issue: "${noisy.title}" (${noisy.count} events).`);
    return { health: { api: 'ok', ai: ai?.status === 'ok' ? 'ok' : 'offline (local rules active)', db: store.kind, evaluatedBuckets: g.filter(Boolean).length }, insights };
  });
  add('POST', '/p/:pid/ai/run', ADM, async c => { const p = await proj(c); const inc = await evaluate(p); return { evaluated: true, incident: inc } });

  async function handle(req: Req): Promise<Res> {
    try {
      const path = req.path.replace(/\/+$/, '') || '/';
      for (const r of routes) {
        if (r.m !== req.method) continue; const m = path.match(r.re); if (!m) continue;
        const params: Record<string, string> = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) });
        let user: Claims | null = null, project: Project | undefined;
        if (r.auth === 'key') { if (!req.key) bad(401, 'Missing API key (x-pulse-key header)'); project = (await C.projects.get({ key: req.key })) || bad(401, 'Invalid API key') }
        else if (r.auth) { user = req.token ? d.verify(req.token, 'access') : null; if (!user) bad(401, 'Please log in'); if (!r.auth.includes(user.role)) bad(403, `Your role (${user.role}) cannot do this`) }
        return { status: 200, body: await r.fn({ params, q: req.query || {}, body: req.body ?? {}, user, project }) };
      }
      return { status: 404, body: { error: 'Not found' } };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      if (e instanceof ZodError) return { status: 400, body: { error: 'Validation failed', issues: e.issues.map(i => `${i.path.join('.')}: ${i.message}`) } };
      console.error(e); return { status: 500, body: { error: 'Something went wrong' } };
    }
  }
  const canJoin = async (token: string, pid: string) => { const u = d.verify(token, 'access'); return !!u && !!(await C.projects.get({ id: pid, oid: u.oid })) };
  return { handle, ingest, evaluate, watchdog, tick, runMonitors, cleanup, canJoin, addDeploy, store, sim, lastTick };
}
