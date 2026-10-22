import { useEffect, useId, useRef, useState } from 'react';
import { hm } from '../util';
export interface Line { name: string; color: string; data: { t: number; v: number }[] }
type Pt = [number, number];
const smooth = (p: Pt[]) => p.length < 2 ? '' : p.reduce((d, pt, i, a) => { if (!i) return `M${pt[0].toFixed(1)},${pt[1].toFixed(1)}`; const p0 = a[i - 2] || a[i - 1], p1 = a[i - 1], p3 = a[i + 1] || pt, c1 = [p1[0] + (pt[0] - p0[0]) / 6, p1[1] + (pt[1] - p0[1]) / 6], c2 = [pt[0] - (p3[0] - p1[0]) / 6, pt[1] - (p3[1] - p1[1]) / 6]; return d + ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${pt[0].toFixed(1)},${pt[1].toFixed(1)}` }, '');
/** Smooth live chart: area + lines, hover crosshair, incident bands, deploy markers, threshold line, pulsing "now" dot. */
export function LiveChart({ lines, height = 190, fmt = (n: number) => String(Math.round(n * 10) / 10), markers = [], spans = [], threshold, area = true, className = '' }: { lines: Line[]; height?: number; fmt?: (n: number) => string; markers?: { t: number; label: string }[]; spans?: { from: number; to: number }[]; threshold?: number; area?: boolean; className?: string }) {
  const id = useId().replace(/:/g, ''), W = 800, L = 46, R = 12, T = 10, Bt = 22, H = height, ref = useRef<SVGSVGElement>(null), [hover, setHover] = useState<number | null>(null), [draw, setDraw] = useState(true);
  useEffect(() => { const t = setTimeout(() => setDraw(false), 1400); return () => clearTimeout(t) }, []);
  const pts = lines[0]?.data || [];
  if (pts.length < 2) return <div className="chart-empty m">Waiting for data...</div>;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, max = Math.max(...lines.flatMap(l => l.data.map(d => d.v)), threshold || 0, 1e-9) * 1.18, X = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R), Y = (v: number) => T + (1 - v / max) * (H - T - Bt);
  const move = (e: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, i = Math.round(((x - L) / (W - L - R)) * (pts.length - 1)); setHover(Math.max(0, Math.min(pts.length - 1, i))) };
  const ticks = [0, 0.5, 1].map(f => max * f / 1.18 * 1.18 * 0 + (max / 1.18) * f);
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={'lc ' + className} onMouseMove={move} onMouseLeave={() => setHover(null)} role="img" aria-label="Time series chart">
      <defs>{lines.map((l, i) => <linearGradient key={i} id={`${id}g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={l.color} stopOpacity=".28" /><stop offset="1" stopColor={l.color} stopOpacity="0" /></linearGradient>)}</defs>
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="gl" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" className="ax">{fmt(v)}</text></g>)}
      {[0, 0.25, 0.5, 0.75, 1].map(f => <text key={f} x={L + f * (W - L - R)} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="ax">{hm(t0 + f * (t1 - t0))}</text>)}
      {spans.map((s, i) => { const a = Math.max(L, X(s.from)), b = Math.min(W - R, X(s.to)); return b > a ? <rect key={i} x={a} y={T} width={b - a} height={H - T - Bt} className="span" /> : null })}
      {markers.filter(m => m.t >= t0 && m.t <= t1).map((m, i) => <g key={i}><line x1={X(m.t)} x2={X(m.t)} y1={T} y2={H - Bt} className="mk" /><text x={X(m.t) + 4} y={T + 10} className="mkt">{m.label}</text></g>)}
      {threshold !== undefined && <line x1={L} x2={W - R} y1={Y(threshold)} y2={Y(threshold)} className="thr" />}
      {lines.map((l, i) => { const p = l.data.map(d => [X(d.t), Y(d.v)] as Pt), d = smooth(p); return <g key={i}>{area && i === 0 && <path d={`${d} L${p[p.length - 1][0]},${H - Bt} L${p[0][0]},${H - Bt} Z`} fill={`url(#${id}g${i})`} />}<path d={d} className={'ln' + (draw ? ' draw' : '')} pathLength={1} stroke={l.color} /><circle cx={p[p.length - 1][0]} cy={p[p.length - 1][1]} r="3.5" fill={l.color} className="nowdot" /></g> })}
      {hover !== null && <g><line x1={X(pts[hover].t)} x2={X(pts[hover].t)} y1={T} y2={H - Bt} className="cross" />{lines.map((l, i) => <circle key={i} cx={X(l.data[hover].t)} cy={Y(l.data[hover].v)} r="4" fill={l.color} stroke="#05060b" strokeWidth="2" />)}
        <g transform={`translate(${Math.min(W - 150, Math.max(L, X(pts[hover].t) + 10))},${T + 6})`}><rect width="140" height={18 + lines.length * 16} rx="6" className="tip" /><text x="8" y="14" className="tipt">{hm(pts[hover].t)}</text>{lines.map((l, i) => <text key={i} x="8" y={30 + i * 16} className="tipv" fill={l.color}>{l.name} {fmt(l.data[hover].v)}</text>)}</g></g>}
    </svg>
  );
}
export function Spark({ data, color = 'var(--ac)', h = 30 }: { data: number[]; color?: string; h?: number }) {
  const max = Math.max(...data, 1e-9), p: Pt[] = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * 100, h - 2 - (v / max) * (h - 4)]);
  return <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="spark"><path d={smooth(p)} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>;
}
