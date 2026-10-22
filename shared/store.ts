import { Query } from 'mingo';
export interface ListOpts { sort?: Record<string, 1 | -1>; skip?: number; limit?: number }
export interface Col<T = any> { list(f?: any, o?: ListOpts): Promise<T[]>; get(f: any): Promise<T | null>; insert(d: T): Promise<T>; update(f: any, u: any): Promise<T | null>; remove(f: any): Promise<boolean>; count(f?: any): Promise<number> }
export interface Store { kind: 'memory' | 'mongo'; col<T = any>(name: string): Col<T>; close(): Promise<void> }
const ops = (u: any) => (Object.keys(u).some(k => k.startsWith('$')) ? u : { $set: u });
export function applyUpdate(doc: any, u: any) {
  const o = ops(u);
  for (const [k, v] of Object.entries<any>(o.$set || {})) doc[k] = v;
  for (const [k, v] of Object.entries<any>(o.$inc || {})) doc[k] = (doc[k] || 0) + v;
  for (const [k, v] of Object.entries<any>(o.$push || {})) (doc[k] ||= []).push(v);
  return doc;
}
export { ops };
class MemCol<T> implements Col<T> {
  rows: any[] = [];
  async list(f: any = {}, o: ListOpts = {}) { let c = new Query(f).find(this.rows); if (o.sort) c = c.sort(o.sort); if (o.skip) c = c.skip(o.skip); if (o.limit) c = c.limit(o.limit); return c.all().map((x: any) => structuredClone(x)) as T[] }
  async get(f: any) { const r = this.rows.find(x => new Query(f).test(x)); return r ? (structuredClone(r) as T) : null }
  async insert(d: T) { this.rows.push(structuredClone(d)); return d }
  async update(f: any, u: any) { const r = this.rows.find(x => new Query(f).test(x)); if (!r) return null; applyUpdate(r, u); return structuredClone(r) as T }
  async remove(f: any) { const i = this.rows.findIndex(x => new Query(f).test(x)); if (i < 0) return false; this.rows.splice(i, 1); return true }
  async count(f: any = {}) { return new Query(f).find(this.rows).all().length }
}
/** Isomorphic in-memory store: used for tests, local demos and the in-browser preview. */
export function memoryStore(): Store {
  const m = new Map<string, MemCol<any>>();
  return { kind: 'memory', col: (n: string) => { if (!m.has(n)) m.set(n, new MemCol()); return m.get(n)! as Col<any> }, close: async () => {} };
}
