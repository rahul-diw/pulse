import { useEffect, useState } from 'react';
import { NavLink, Outlet, useParams, Navigate } from 'react-router-dom';
import { api } from '../api';
import { join } from '../realtime';
import { TLink, useGo } from '../components/nav';
import { Sev } from '../components/ui';
import { useStore, logout, canWrite } from '../store';
import { usePoll, dur } from '../util';
export interface Ctx { pid: string; project: any; role: string }
const TABS: [string, string][] = [['overview', 'Overview'], ['logs', 'Live logs'], ['issues', 'Issues'], ['incidents', 'Incidents'], ['metrics', 'Metrics'], ['uptime', 'Uptime'], ['alerts', 'Alerts'], ['settings', 'Settings']];
const SCEN: [string, string, string][] = [['normal', 'Back to normal', 'Stop the simulation'], ['spike', 'Traffic spike', '3x traffic'], ['outage', 'Checkout outage', 'DB refused + null errors'], ['slow_db', 'Slow database', '6x latency'], ['bad_deploy', 'Bad deploy', 'New release breaks search']];
export default function AppLayout() {
  const { pid } = useParams(), user = useStore(s => s.user)!, token = useStore(s => s.token), go = useGo(), [msg, setMsg] = useState('');
  const projects = usePoll(() => api('GET', '/projects'), 5000, [pid]).data as any[] | null;
  const incs = usePoll(() => (pid ? api('GET', `/p/${pid}/incidents`) : Promise.resolve([])), 3000, [pid]).data as any[] | null;
  useEffect(() => { if (pid) join(token, pid) }, [pid, token]);
  if (!projects) return <div className="page"><div className="skel" /></div>;
  if (!pid || !projects.find(p => p.id === pid)) return projects.length ? <Navigate to={`/app/${projects[0].id}/overview`} replace /> : <div className="page"><h1 className="big">No projects yet.</h1></div>;
  const project = projects.find(p => p.id === pid), open = (incs || []).filter(i => i.status !== 'resolved')[0];
  const run = async (s: string) => { try { await api('POST', `/p/${pid}/simulate`, { scenario: s }); setMsg(s === 'normal' ? 'Simulation stopped.' : 'Running for 2.5 minutes. Watch Overview: Pulse should open an incident within ~30 seconds.') } catch (e: any) { setMsg(e.message) } setTimeout(() => setMsg(''), 6000) };
  return (
    <div className="app">
      <header className="ah"><TLink to="/" className="logo" data-cur="Home"><i className="pdot" />Pulse</TLink>
        <select className="psel" value={pid} onChange={e => go(`/app/${e.target.value}/overview`)} aria-label="Project">{projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.env})</option>)}</select>
        <span className="live mono"><i className="live-dot" />LIVE</span><span className="sp" />
        {project.sim && canWrite(user.role) && <details className="sim"><summary className="btn sm">Simulate &#9662;</summary><div className="menu">{SCEN.map(([k, l, d]) => <button key={k} onClick={() => run(k)} className={project.scenario === k ? 'on' : ''}><b>{l}</b><span className="m">{d}</span></button>)}</div></details>}
        <span className="mono m who">{user.name} &middot; {user.role}</span><button className="btn sm" onClick={() => { logout(); go('/') }}>Log out</button></header>
      {msg && <div className="toast">{msg}</div>}
      {project.scenario !== 'normal' && <div className="scn-chip mono">Simulating: {project.scenario.replace('_', ' ')}</div>}
      {open && <TLink to={`/app/${pid}/incidents/${open.id}`} className={'banner ' + open.severity} data-cur="Open"><i className="siren" /><b>{open.title}</b><Sev s={open.severity} /><span className="m mono">{open.status} &middot; {dur(open.startedAt, Date.now())}</span><span className="go">View incident &rarr;</span></TLink>}
      <nav className="atabs">{TABS.map(([k, l]) => <NavLink key={k} to={`/app/${pid}/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}>{l}{k === 'incidents' && open ? <em className="cnt">1</em> : null}</NavLink>)}</nav>
      <div className="abody"><Outlet context={{ pid, project, role: user.role } satisfies Ctx} /></div>
    </div>
  );
}
