import { useEffect, useRef, type ReactElement } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import Cursor from './components/Cursor';
import { setCurtain, TLink, useGo } from './components/nav';
import { startRealtime } from './realtime';
import { api } from './api';
import { useStore } from './store';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import AppLayout from './pages/AppLayout';
import Overview from './pages/Overview';
import Logs from './pages/Logs';
import { IssueList, IssueDetail } from './pages/Issues';
import { IncidentList, IncidentDetail } from './pages/Incidents';
import { Metrics, Uptime, Alerts, Settings } from './pages/Panels';
gsap.registerPlugin(ScrollTrigger);
export let lenis: Lenis | null = null;
function Header() {
  const user = useStore(s => s.user);
  return (<header className="hd"><TLink to="/" className="logo" data-cur="Home"><i className="pdot" />Pulse</TLink><div className="hr">{user ? <TLink to="/app" className="btn sm pr">Open dashboard</TLink> : <><TLink to="/login">Log in</TLink><TLink to="/signup" className="btn sm pr">Start free</TLink></>}</div></header>);
}
function AppHome() { const go = useGo(); useEffect(() => { api('GET', '/projects').then(p => p.length && go(`/app/${p[0].id}/overview`)).catch(() => {}) }, []); return <div className="page"><div className="skel" /><p className="m mono" style={{ marginTop: 16 }}>Starting the Pulse engine and replaying the last hour of traffic...</p></div> }
const Guard = ({ children }: { children: ReactElement }) => (useStore(s => s.user) ? children : <Navigate to="/login?next=/app" replace />);
export default function App() {
  const loc = useLocation(), cur = useRef<HTMLDivElement>(null), inApp = loc.pathname.startsWith('/app');
  useEffect(() => {
    setCurtain(cur.current); startRealtime();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { lenis = new Lenis({ lerp: 0.09 }); lenis.on('scroll', ScrollTrigger.update); gsap.ticker.add(t => lenis!.raf(t * 1000)); gsap.ticker.lagSmoothing(0) }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0, rootMargin: '0px 0px 12% 0px' });
    const scan = () => document.querySelectorAll('.rv:not(.in)').forEach(n => io.observe(n)), mo = new MutationObserver(scan); mo.observe(document.getElementById('root')!, { childList: true, subtree: true }); scan();
    const refresh = () => ScrollTrigger.refresh(); document.fonts?.ready.then(refresh); window.addEventListener('load', refresh);
    return () => { mo.disconnect(); io.disconnect(); lenis?.destroy(); window.removeEventListener('load', refresh) };
  }, []);
  useEffect(() => { lenis?.scrollTo(0, { immediate: true }); ScrollTrigger.refresh() }, [loc.pathname.startsWith('/app') ? 'app' : loc.pathname]);
  return (
    <>
      <div className="grain" /><Cursor />{!inApp && <Header />}<div className="curtain" ref={cur}><span>Pulse</span></div>
      <main key={inApp ? 'app' : loc.pathname} className="pg">
        <Routes>
          <Route path="/" element={<Landing />} /><Route path="/login" element={<Auth />} /><Route path="/signup" element={<Auth signup />} />
          <Route path="/app" element={<Guard><AppHome /></Guard>} />
          <Route path="/app/:pid" element={<Guard><AppLayout /></Guard>}>
            <Route index element={<Navigate to="overview" replace />} /><Route path="overview" element={<Overview />} /><Route path="logs" element={<Logs />} />
            <Route path="issues" element={<IssueList />} /><Route path="issues/:iid" element={<IssueDetail />} /><Route path="incidents" element={<IncidentList />} /><Route path="incidents/:id" element={<IncidentDetail />} />
            <Route path="metrics" element={<Metrics />} /><Route path="uptime" element={<Uptime />} /><Route path="alerts" element={<Alerts />} /><Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<div className="page"><h1 className="big">Lost.</h1><p className="m"><TLink to="/" className="ul">Back home</TLink></p></div>} />
        </Routes>
      </main>
      {!inApp && <footer className="ft"><div><b className="logo"><i className="pdot" />Pulse</b><p className="m">Live monitoring with an AI watchdog. A portfolio product by Rahul Diwakar.</p></div><div className="mono m">React &middot; TypeScript &middot; Node &middot; MongoDB &middot; Python</div></footer>}
    </>
  );
}
