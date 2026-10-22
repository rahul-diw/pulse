import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { api } from '../api';
import Heartbeat from '../components/Heartbeat';
import { Spark } from '../components/LiveChart';
import Tabs from '../components/Tabs';
import { TLink, useGo } from '../components/nav';
import { setAuth } from '../store';
const A = [18, 22, 19, 25, 24, 28, 26, 31, 29, 33, 30, 36, 34, 38], LOGS: [string, string][] = [['info', 'GET /api/products 200 41ms'], ['info', 'POST /api/login 200 88ms'], ['warn', 'slow query took 410ms'], ['info', 'order 48213 processed'], ['info', 'GET /api/search 200 63ms'], ['error', 'TypeError: Cannot read properties of undefined'], ['error', 'ECONNREFUSED 10.0.2.15:5432'], ['error', 'HTTP 500 POST /api/checkout']];
const SNIP = `import { Pulse } from './pulse.mjs';\nconst pulse = new Pulse({ key: 'pk_...', url: 'https://your-pulse-api' });\napp.use(pulse.middleware());\napp.use(pulse.errorHandler());`;
export default function Landing() {
  const root = useRef<HTMLDivElement>(null), go = useGo(), [mode, setMode] = useState<'ok' | 'bad'>('ok');
  useEffect(() => {
    let m: 'ok' | 'bad' = 'ok';
    const ctx = gsap.context(() => {
      gsap.set('.s2,.s3,.s4,.s5', { opacity: 0 }); gsap.to('.hero .ln>i', { yPercent: 0, duration: 1.3, ease: 'power4.out', delay: 0.15 }); gsap.set('.hero .ln>i', { yPercent: 112 }); gsap.to('.hero .ln>i', { yPercent: 0, duration: 1.3, ease: 'power4.out', delay: 0.2 });
      gsap.from('.s1 .mono,.fcard', { opacity: 0, y: 40, stagger: 0.1, duration: 1, delay: 0.5 });
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        const out = { opacity: 0, y: -60, filter: 'blur(12px)', duration: 0.8 }, from = { opacity: 0, y: 60, filter: 'blur(12px)' }, inn = { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8 };
        gsap.timeline({ scrollTrigger: { trigger: '.hwrap', start: 'top top', end: 'bottom bottom', scrub: 0.5, onUpdate: s => { const n = s.progress > 0.37 && s.progress < 0.78 ? 'bad' : 'ok'; if (n !== m) { m = n; setMode(n) } } } })
          .to('.fcard', { yPercent: (i) => -30 - i * 20, duration: 10, ease: 'none' }, 0).to('.s1', out, 1.2).fromTo('.s2', from, inn, 2).to('.s2', out, 3.6).fromTo('.s3', from, inn, 4.2).to('.s3', out, 5.4).fromTo('.s4', from, inn, 6).to('.s4', out, 8.2).fromTo('.s5', from, inn, 8.8).to({}, { duration: 1 }, 9.8);
      });
    }, root);
    return () => ctx.revert();
  }, []);
  const demo = async () => { setAuth(await api('POST', '/auth/login', { email: 'owner@pulse.dev', password: 'Demo@123' })); go('/app') };
  const F: [string, string, string][] = [['Live logs', 'Stream every log line as it happens. Filter by level and service, search, pause.', '>_'], ['Issue grouping', 'Thousands of similar errors collapse into one issue, with a trend and similar issues.', '#'], ['AI watchdog', 'Robust statistics plus an Isolation Forest model learn what normal looks like and flag what is not.', '\u2726'], ['Incidents with a story', 'Each incident explains what changed, which route fails, the top error, and the deploy that preceded it.', '!'], ['Uptime monitors', 'Ping your URLs every minute. Two failures in a row opens an incident.', '\u2191'], ['Alerts and deploys', 'Hard-limit rules, plus deploy markers drawn on every chart.', '\u25b2']];
  return (
    <div ref={root}>
      <section className="hwrap"><div className="hero">
        <Heartbeat mode={mode} className="hbline" /><div className={'vig ' + mode} />
        <div className="fcs"><div className="fcard c1"><span className="mono m">REQUESTS / SEC</span><b>38.4</b><Spark data={A} /></div><div className="fcard c2"><span className="mono m">LIVE LOGS</span>{LOGS.map((l, i) => <div key={i} className={'fl ' + l[0]} style={{ animationDelay: i * 0.4 + 's' }}>{l[1]}</div>)}</div><div className="fcard c3"><span className="mono m">P95 LATENCY</span><b className={mode === 'bad' ? 'bad' : ''}>{mode === 'bad' ? '1.5s' : '112ms'}</b><span className="m mono sm">{mode === 'bad' ? 'error rate 31%' : 'error rate 0.8%'}</span></div></div>
        <div className="scn s1"><p className="mono m">Live monitoring &middot; AI watchdog &middot; open SDK</p><h1 className="mega"><span className="ln"><i>Pulse</i></span></h1><p className="tagline">Know before your users do.</p><div className="hmeta mono"><span>For developers who ship</span><span>Scroll to see it work</span></div></div>
        <div className="scn s2"><h2 className="big">Every log, error and metric.<br /><em>One live view.</em></h2></div>
        <div className="scn s3"><h2 className="big bad">Then something<br />breaks.</h2></div>
        <div className="scn s4"><div className="incdemo"><div className="ih"><span className="sev critical">critical</span><span className="st open"><i />open</span><span className="m mono" style={{ marginLeft: 'auto' }}>detected in ~30s</span></div><h3>Error rate spike on POST /api/checkout</h3><p>Error rate jumped from 0.8% to 31%. 94% of the errors come from POST /api/checkout. Most frequent error: "Error: connect ECONNREFUSED &lt;n&gt;" (212 times). It started 2 min after deploy v1.8.3.</p><p className="hint">Roll back or hotfix v1.8.3, then watch the error rate recover.</p></div></div>
        <div className="scn s5"><h2 className="big">Try the outage<br /><em>yourself.</em></h2><div className="ctas"><button className="btn pr" onClick={demo}>Open the live demo</button><TLink to="/signup" className="btn">Create a workspace</TLink></div></div>
      </div></section>
      <section className="sec"><div className="tag mono rv">How it works</div><div className="how rv"><div><b>01</b><h3>Add 3 lines</h3><p className="m">Drop the SDK into your app. It batches events and never blocks or crashes your code.</p><pre className="code sm">{SNIP}</pre></div><div><b>02</b><h3>Pulse learns normal</h3><p className="m">Every 10 seconds it compares the latest traffic with the last 10 minutes, with robust statistics and an Isolation Forest model.</p></div><div><b>03</b><h3>It opens the incident</h3><p className="m">With a plain-language summary, the failing route, the top error and the deploy behind it. It closes the incident itself when things recover.</p></div></div></section>
      <section className="sec"><div className="tag mono rv">Everything in one place</div><h2 className="big rv">Built for the<br /><em>3 a.m. page.</em></h2><div className="fgrid rv">{F.map(f => <div key={f[0]} className="fcell"><span className="glyph mono">{f[2]}</span><h3>{f[0]}</h3><p className="m">{f[1]}</p></div>)}</div></section>
      <section className="sec"><div className="tag mono rv">Under the hood</div><div className="pipe rv">{['SDK', 'Ingest API', '10s buckets', 'AI watchdog', 'Incident', 'Live dashboard'].map((p, i) => <div key={p} className="pnode"><b>{p}</b><span className="m mono">{['batching, never throws', 'API key, rate limits', 'histograms for p50/p95/p99', 'median + MAD, Isolation Forest', 'summary, hints, auto-resolve', 'Socket.IO, smooth charts'][i]}</span></div>)}</div></section>
      <section className="sec"><div className="tag mono rv">Try it now</div><div className="try rv"><div className="card"><h3>Run an outage</h3><p className="m">Open the demo, press <b>Simulate &rarr; Checkout outage</b> and watch Pulse detect it, explain it and close it.</p><button className="btn pr" onClick={demo}>Open the live demo</button></div><div className="card"><h3>Monitor your own app</h3><p className="m">Create a workspace, copy your key, add the SDK. Your real traffic shows up in seconds.</p><TLink to="/signup" className="btn pr">Create a workspace</TLink></div><div className="card"><h3>Read the code</h3><p className="m">React + TypeScript, Node, MongoDB, Python. Docker, CI and a full test suite included.</p><a className="btn" href="https://github.com/rahul-diw" target="_blank" rel="noopener">GitHub</a></div></div></section>
    </div>
  );
}
