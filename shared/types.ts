export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface Org { id: string; name: string; createdAt: string }
export interface User { id: string; oid: string; name: string; email: string; hash: string; role: Role; createdAt: string }
export interface Project { id: string; oid: string; name: string; env: string; key: string; sim: boolean; webhook?: string; createdAt: string }
export interface RouteStat { req: number; err: number; latSum: number }
export interface Bucket { id: string; pid: string; t: number; req: number; err: number; latSum: number; hist: number[]; routes: Record<string, RouteStat>; logs: number; errLogs: number; custom: Record<string, { sum: number; n: number }> }
export interface LogDoc { id: string; pid: string; t: number; level: Level; message: string; service: string; release?: string; meta?: Record<string, unknown>; fp?: string }
export interface Issue { id: string; pid: string; fp: string; title: string; level: Level; service: string; count: number; firstSeen: number; lastSeen: number; status: 'open' | 'resolved' | 'ignored'; sample: { message: string; meta?: Record<string, unknown> }; regressed?: boolean }
export interface Signal { kind: 'error_rate' | 'latency' | 'traffic_drop' | 'rule'; value: number; baseline: number; z: number; label?: string; ruleId?: string }
export interface Incident { id: string; pid: string; source: 'watchdog' | 'monitor'; title: string; severity: 'critical' | 'major' | 'minor'; status: 'open' | 'acknowledged' | 'resolved'; startedAt: number; resolvedAt?: number; lastSignalAt: number; quietBuckets: number; signals: Signal[]; summary: string; hints: string[]; timeline: { t: number; text: string }[]; topRoutes: { route: string; req: number; err: number }[]; culprit?: { route: string; errRate: number; overall: number }; topIssues: { issueId: string; title: string; count: number }[]; deploy?: { version: string; minsBefore: number }; peak: { errRate: number; p95: number }; baseline: { errRate: number; p95: number }; ml?: number; autoResolved?: boolean }
export interface Deploy { id: string; pid: string; version: string; note: string; t: number }
export interface Monitor { id: string; pid: string; name: string; url: string; status: 'up' | 'down' | 'unknown'; lastMs: number; lastCheck: number; checks: { t: number; ok: boolean; ms: number }[] }
export interface Rule { id: string; pid: string; name: string; metric: 'error_rate' | 'p95' | 'rps' | 'log_errors'; op: '>' | '<'; threshold: number; windowBuckets: number; severity: 'critical' | 'major' | 'minor'; enabled: boolean }
export interface Claims { sub: string; oid: string; role: Role; name: string }
export type IngestEvent =
  | { type: 'request'; t?: number; method: string; route: string; status: number; ms: number; service?: string; release?: string }
  | { type: 'log'; t?: number; level: Level; message: string; service?: string; release?: string; meta?: Record<string, unknown> }
  | { type: 'metric'; t?: number; name: string; value: number };
