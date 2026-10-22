import { useEffect, useRef, useState } from 'react';
export const fmtMs = (n: number) => (n >= 1000 ? (n / 1000).toFixed(2) + 's' : Math.round(n) + 'ms');
export const fmtPct = (x: number, d = 1) => (x * 100).toFixed(x > 0 && x < 0.1 ? d : x < 1 ? 1 : 0) + '%';
export const fmtNum = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-IN'));
export const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const hm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago' };
export const dur = (a: number, b: number) => { const s = Math.max(0, Math.round((b - a) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm' };
/** Smoothly tweens a number whenever it changes. */
export function useTween(v: number, ms = 700) {
  const [x, setX] = useState(v), from = useRef(v);
  useEffect(() => { const s = performance.now(), f = from.current; let raf = 0; const step = (t: number) => { const k = Math.min(1, (t - s) / ms), e = 1 - Math.pow(1 - k, 3); setX(f + (v - f) * e); if (k < 1) raf = requestAnimationFrame(step); else from.current = v }; raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf) }, [v]);
  return x;
}
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null), [err, setErr] = useState('');
  useEffect(() => { let dead = false; const run = () => fn().then(d => { if (!dead) { setData(d); setErr('') } }).catch(e => { if (!dead) setErr(e.message) }); run(); const t = setInterval(run, ms); return () => { dead = true; clearInterval(t) } }, deps);
  return { data, err, setData };
}
