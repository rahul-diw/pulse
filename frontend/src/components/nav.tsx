import { useCallback, type AnchorHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { DEMO } from '../api';
let curtain: HTMLElement | null = null, busy = false;
export const setCurtain = (e: HTMLElement | null) => { curtain = e };
/** Navigate behind a full-screen curtain wipe (the "new page opens" feel). */
export function useGo() {
  const nav = useNavigate();
  return useCallback((to: string) => {
    if (!curtain || busy || matchMedia('(prefers-reduced-motion: reduce)').matches) { nav(to); window.scrollTo(0, 0); return }
    busy = true; const c = curtain;
    gsap.timeline().set(c, { yPercent: 100, display: 'block' })
      .to(c, { yPercent: 0, duration: 0.55, ease: 'power4.inOut', onComplete: () => { nav(to); window.scrollTo(0, 0) } })
      .to(c, { yPercent: -100, duration: 0.6, ease: 'power4.inOut', delay: 0.15, onComplete: () => { busy = false; c.style.display = 'none' } });
  }, [nav]);
}
export function TLink({ to, children, ...p }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const go = useGo();
  return <a href={(DEMO ? '#' : '') + to} {...p} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(to) }}>{children}</a>;
}
