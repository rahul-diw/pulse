import type { Bucket, Signal, Rule, Incident } from './types';
import { B, pct, mergeHist, emptyHist } from './metrics';
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
const mad = (a: number[], m: number) => 1.4826 * med(a.map(x => Math.abs(x - m)));
export interface Win { req: number; err: number; errRate: number; p95: number; rate: number; errLogs: number }
/** n buckets ending at endT (exclusive); missing buckets are null (= no traffic). */
export function grid(bs: Bucket[], endT: number, n: number): (Bucket | null)[] { const m = new Map(bs.map(b => [b.t, b])); return Array.from({ length: n }, (_, i) => m.get(endT - (n - i) * B) || null) }
export function windowOf(bs: (Bucket | null)[]): Win { let req = 0, err = 0, errLogs = 0, h = emptyHist(); for (const b of bs) { if (!b) continue; req += b.req; err += b.err; errLogs += b.errLogs; h = mergeHist(h, b.hist) } return { req, err, errLogs, errRate: req ? err / req : 0, p95: pct(h, 0.95), rate: bs.length ? req / bs.length / (B / 1000) : 0 } }
/** Robust (median/MAD) anomaly detection: last 3 buckets vs the 10 minutes before them. */
export function detect(all: (Bucket | null)[], cur = 3): Signal[] {
  const out: Signal[] = [], curB = all.slice(-cur), base = all.slice(0, -cur), w = windowOf(curB);
  if (base.filter(b => b && b.req > 0).length < 12) return out;
  const baseErr = base.map(b => (b && b.req >= 3 ? b.err / b.req : 0)), baseP95 = base.filter(b => b && b.req >= 3).map(b => pct(b!.hist, 0.95)), baseReq = base.map(b => (b ? b.req : 0));
  const me = med(baseErr), se = Math.max(mad(baseErr, me), 0.01);
  if (w.req >= 12 && w.errRate >= Math.max(0.05, me + 6 * se)) out.push({ kind: 'error_rate', value: w.errRate, baseline: me, z: (w.errRate - me) / se });
  const mp = med(baseP95), sp = Math.max(mad(baseP95, mp), 20);
  if (w.req >= 12 && w.p95 >= Math.max(300, mp * 1.8, mp + 6 * sp)) out.push({ kind: 'latency', value: w.p95, baseline: mp, z: (w.p95 - mp) / sp });
  const mr = med(baseReq), avg = w.req / cur;
  if (mr >= 3 && avg <= 0.25 * mr) out.push({ kind: 'traffic_drop', value: avg, baseline: mr, z: (mr - avg) / Math.max(1, mad(baseReq, mr)) });
  return out;
}
export function evalRule(r: Rule, all: (Bucket | null)[]): Signal | null {
  const w = windowOf(all.slice(-r.windowBuckets)), v = r.metric === 'error_rate' ? w.errRate : r.metric === 'p95' ? w.p95 : r.metric === 'rps' ? w.rate : w.errLogs;
  if (r.metric !== 'rps' && w.req < 5 && r.metric !== 'log_errors') return null;
  return (r.op === '>' ? v > r.threshold : v < r.threshold) ? { kind: 'rule', value: v, baseline: r.threshold, z: 0, label: r.name, ruleId: r.id } : null;
}
const P = (x: number) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%', ms = (x: number) => (x >= 1000 ? (x / 1000).toFixed(1) + 's' : Math.round(x) + 'ms');
export const PATTERNS: [RegExp, string][] = [
  [/econn|etimedout|enotfound|connection refused|timeout|unreachable/i, 'A dependency looks unreachable. Check the database, cache or upstream service and the network rules between them.'],
  [/out of memory|heap|oom|memory/i, 'Memory pressure shows up in the errors. Look for leaks and check the container memory limit.'],
  [/undefined|null|cannot read|is not a function/i, 'A null or undefined access in a code path points to a code regression. Open the top issue and read its sample.'],
  [/slow query|deadlock|lock wait|query timeout/i, 'Database contention. Check slow queries, locks and missing indexes.'],
  [/unexpected token|json|parse|syntaxerror/i, 'A payload or response is malformed. Check the upstream service and any recent schema or build change.'],
];
export function describe(i: Pick<Incident, 'signals' | 'topRoutes' | 'topIssues' | 'deploy' | 'baseline' | 'peak' | 'culprit'>) {
  const s: string[] = [], hints: string[] = [], sig = (k: string) => i.signals.find(x => x.kind === k);
  const e = sig('error_rate'), l = sig('latency'), t = sig('traffic_drop');
  if (e) s.push(`Error rate jumped from ${P(e.baseline)} to ${P(e.value)}.`);
  if (l) s.push(`p95 latency rose from ${ms(l.baseline)} to ${ms(l.value)}.`);
  if (t) s.push(`Traffic fell to ${Math.round((t.value / (t.baseline || 1)) * 100)}% of normal.`);
  i.signals.filter(x => x.kind === 'rule').forEach(r => s.push(`Alert rule "${r.label}" fired (${r.value.toFixed(r.value < 10 ? 2 : 0)} vs limit ${r.baseline}).`));
  if (i.culprit) s.push(`${i.culprit.route} is failing the most: ${P(i.culprit.errRate)} of its requests return errors (${P(i.culprit.overall)} overall).`);
  if (i.topIssues[0]) s.push(`Most frequent error: "${i.topIssues[0].title}" (${i.topIssues[0].count} times).`);
  if (i.deploy) { s.push(`It started ${i.deploy.minsBefore} min after deploy ${i.deploy.version}.`); hints.push(`Roll back or hotfix ${i.deploy.version}, then watch the error rate recover.`) }
  const text = i.topIssues.map(x => x.title).join(' ');
  for (const [re, h] of PATTERNS) if (re.test(text) && hints.length < 3) hints.push(h);
  if (t) hints.push('Check the load balancer, DNS and whether the app is still receiving traffic at all.');
  if (l && !e) s.push('Requests are succeeding, but slowly, and the slowdown is not tied to one route.');
  if (l && !e) hints.push('Latency without errors usually means saturation or a slow dependency. Check CPU, database and downstream latency.');
  if (!hints.length) hints.push('Compare this window with the previous hour and inspect the top issues below.');
  return { summary: s.join(' ') || 'Metrics moved outside their normal range.', hints };
}
export function severityOf(signals: Signal[]): Incident['severity'] {
  const e = signals.find(s => s.kind === 'error_rate'), l = signals.find(s => s.kind === 'latency'), t = signals.find(s => s.kind === 'traffic_drop');
  if ((e && e.value >= 0.25) || (t && t.value < 0.1 * t.baseline)) return 'critical';
  if ((e && e.value >= 0.1) || (l && l.value >= 3 * Math.max(l.baseline, 50))) return 'major';
  return signals.find(s => s.kind === 'rule') ? 'major' : 'minor';
}
