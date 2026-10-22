import type { ReactNode } from 'react';
import { useTween, fmtMs, fmtPct, fmtNum } from '../util';
export const Sev = ({ s }: { s: string }) => <span className={'sev ' + s}>{s}</span>;
export const Status = ({ s }: { s: string }) => <span className={'st ' + s}><i />{s}</span>;
export function Kpi({ label, value, kind = 'num', sub, delta, goodDown = true }: { label: string; value: number; kind?: 'num' | 'pct' | 'ms' | 'rate'; sub?: ReactNode; delta?: number; goodDown?: boolean }) {
  const v = useTween(value), txt = kind === 'pct' ? fmtPct(v, 2) : kind === 'ms' ? fmtMs(v) : kind === 'rate' ? v.toFixed(1) + '/s' : fmtNum(v), up = delta !== undefined && delta > 0.03, down = delta !== undefined && delta < -0.03, bad = (up && goodDown) || (down && !goodDown);
  return <div className="kpi card"><span className="m mono">{label}</span><b>{txt}</b><span className="ks">{delta !== undefined && (up || down) && <em className={bad ? 'bad' : 'ok'}>{up ? '\u25b2' : '\u25bc'} {Math.abs(delta * 100).toFixed(0)}%</em>}{sub}</span></div>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty card">{children}</div>;
