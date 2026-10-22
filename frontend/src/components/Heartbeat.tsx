/** ECG-style heartbeat line used on the landing page: calm in "ok" mode, violent and red in "bad" mode. */
export default function Heartbeat({ mode = 'ok', className = '' }: { mode?: 'ok' | 'bad'; className?: string }) {
  const W = 1200, y = 60, beats = mode === 'ok' ? 4 : 7; let d = `M0,${y}`;
  for (let i = 0; i < beats; i++) { const x = (i + 0.5) * (W / beats), a = mode === 'ok' ? 1 : 1.5 + (i % 3) * 0.4, w = mode === 'ok' ? 1 : 0.6; d += ` L${x - 90 * w},${y} L${x - 70 * w},${y - 8} L${x - 50 * w},${y} L${x - 24 * w},${y} L${x - 14 * w},${y + 14 * a} L${x},${y - 56 * a} L${x + 14 * w},${y + 34 * a} L${x + 26 * w},${y} L${x + 60 * w},${y} L${x + 78 * w},${y - 12} L${x + 96 * w},${y}` }
  d += ` L${W},${y}`;
  return (<svg viewBox={`0 0 ${W} 120`} className={'hb ' + mode + ' ' + className} preserveAspectRatio="none" aria-hidden="true"><path d={d} className="base" pathLength={1000} /><path d={d} className="glow" pathLength={1000} /><path d={d} className="glow g2" pathLength={1000} /></svg>);
}
