import type { Bucket, IngestEvent, RouteStat } from './types';
export const B = 10_000; // bucket size: 10 seconds, so dashboards move in real time
export const EDGES = [10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];
export const bucketT = (t: number) => Math.floor(t / B) * B;
export const emptyHist = () => Array(EDGES.length + 1).fill(0) as number[];
export const binOf = (ms: number) => { let i = 0; while (i < EDGES.length && ms >= EDGES[i]) i++; return i };
export const mergeHist = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] || 0));
/** Percentile from a latency histogram (linear interpolation inside the bin). */
export function pct(hist: number[], q: number) {
  const tot = hist.reduce((a, b) => a + b, 0); if (!tot) return 0;
  const target = q * tot; let cum = 0;
  for (let i = 0; i < hist.length; i++) { if (cum + hist[i] >= target) { const lo = i ? EDGES[i - 1] : 0, hi = i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1] * 2; return lo + (hi - lo) * ((target - cum) / (hist[i] || 1)) } cum += hist[i] }
  return EDGES[EDGES.length - 1];
}
export const newBucket = (pid: string, t: number): Bucket => ({ id: `${pid}:${t}`, pid, t, req: 0, err: 0, latSum: 0, hist: emptyHist(), routes: {}, logs: 0, errLogs: 0, custom: {} });
/** Fold one event into a bucket (pure). Only 5xx counts as an error. */
export function addToBucket(b: Bucket, e: IngestEvent) {
  if (e.type === 'request') {
    b.req++; if (e.status >= 500) b.err++; b.latSum += e.ms; b.hist[binOf(e.ms)]++;
    const k = `${e.method.toUpperCase()} ${e.route}`, key = b.routes[k] || Object.keys(b.routes).length < 30 ? k : 'other', r: RouteStat = (b.routes[key] ||= { req: 0, err: 0, latSum: 0 });
    r.req++; r.latSum += e.ms; if (e.status >= 500) r.err++;
  } else if (e.type === 'log') { b.logs++; if (e.level === 'error' || e.level === 'fatal') b.errLogs++ }
  else { const c = (b.custom[e.name] ||= { sum: 0, n: 0 }); c.sum += e.value; c.n++ }
}
const norm = (m: string) => m.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/0x[0-9a-f]+/gi, '<hex>').replace(/\b[0-9a-f]{16,}\b/gi, '<hex>').replace(/https?:\/\/\S+/g, '<url>').replace(/(["'`]).*?\1/g, '<str>').replace(/\d+(\.\d+)?/g, '<n>').replace(/\s+/g, ' ').trim().slice(0, 160);
/** Groups similar error messages: ids, numbers, urls and quoted strings are normalised away. */
export function fingerprint(message: string) { const title = norm(message); let h = 5381; for (const c of title) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return { fp: h.toString(16), title } }
export const tokens = (s: string) => new Set(s.toLowerCase().replace(/<[a-z]+>/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 2));
export const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; a.forEach(x => { if (b.has(x)) i++ }); return i / (a.size + b.size - i || 1) };
