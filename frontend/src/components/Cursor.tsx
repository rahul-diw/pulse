import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
export default function Cursor() {
  const ref = useRef<HTMLDivElement>(null), [label, setLabel] = useState('');
  useEffect(() => {
    if (matchMedia('(hover: none)').matches) return;
    const el = ref.current!, qx = gsap.quickTo(el, 'x', { duration: 0.3, ease: 'power3' }), qy = gsap.quickTo(el, 'y', { duration: 0.3, ease: 'power3' });
    const mv = (e: MouseEvent) => { qx(e.clientX); qy(e.clientY) };
    const ov = (e: MouseEvent) => { const t = (e.target as HTMLElement).closest('[data-cur],a,button,input,select,textarea,summary') as HTMLElement | null; const l = t?.dataset.cur || ''; el.classList.toggle('big', !!t); el.classList.toggle('lab', !!l); setLabel(l) };
    addEventListener('mousemove', mv); addEventListener('mouseover', ov);
    return () => { removeEventListener('mousemove', mv); removeEventListener('mouseover', ov) };
  }, []);
  return <div id="cur" ref={ref}><span>{label}</span></div>;
}
