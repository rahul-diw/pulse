import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { LiveChart } from '../components/LiveChart';
import { TLink } from '../components/nav';
import { Sev, Status, Empty } from '../components/ui';
import { usePoll, ago, clock, dur, fmtMs, fmtPct, fmtNum } from '../util';
import { canAck } from '../store';
import type { Ctx } from './AppLayout';
export function IncidentList() {
  const { pid } = useOutletContext<Ctx>(), { data } = usePoll(() => api('GET', `/p/${pid}/incidents`), 3000, [pid]), list: any[] = data || [];
  return (
    <div>{!list.length && <Empty><h3>No incidents yet</h3><p className="m">When Pulse detects an anomaly it opens an incident here, with an explanation. Try <b>Simulate &rarr; Checkout outage</b> in the header.</p></Empty>}
      <div className="ilist">{list.map(i => <TLink key={i.id} to={`/app/${pid}/incidents/${i.id}`} className={'icard ' + i.severity + (i.status === 'resolved' ? ' done' : '')} data-cur="Open"><div className="ih"><Sev s={i.severity} /><Status s={i.status} />{i.autoResolved && <span className="tg">auto-resolved</span>}<span className="m mono" style={{ marginLeft: 'auto' }}>{ago(i.startedAt)}</span></div><h3>{i.title}</h3><p className="m">{i.summary}</p><span className="m mono sm">Duration {dur(i.startedAt, i.resolvedAt || Date.now())}</span></TLink>)}</div></div>
  );
}
const SIG: Record<string, string> = { error_rate: 'Error rate', latency: 'p95 latency', traffic_drop: 'Traffic drop', rule: 'Alert rule' };
export function IncidentDetail() {
  const { pid, role } = useOutletContext<Ctx>(), { id } = useParams(), [d, setD] = useState<any>(null), [err, setErr] = useState('');
  const load = () => api('GET', `/p/${pid}/incidents/${id}`).then(setD).catch(e => setErr(e.message));
  useEffect(() => { setD(null); load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [pid, id]);
  if (err) return <div><h2 className="big sm">Not found.</h2><p className="m">{err}</p></div>; if (!d) return <div className="skel" />;
  const i = d.incident, act = async (status: string) => { await api('PATCH', `/p/${pid}/incidents/${id}`, { status }); load() };
  const spans = [{ from: i.startedAt, to: i.resolvedAt || Date.now() }], markers = d.deploys.map((x: any) => ({ t: x.t, label: x.version })), maxRoute = Math.max(...i.topRoutes.map((r: any) => r.err), 1);
  return (
    <div className="detail"><TLink to={`/app/${pid}/incidents`} className="mono m">&larr; All incidents</TLink>
      <div className={'dh inc ' + i.severity}><div><Sev s={i.severity} /> <Status s={i.status} />{i.autoResolved && <span className="tg">auto-resolved</span>}{i.ml !== undefined && <span className="tg" title="Isolation Forest anomaly score from the Python service">ML anomaly {i.ml}</span>}<h2 className="ttl">{i.title}</h2><p className="m">Started {ago(i.startedAt)} &middot; {i.status === 'resolved' ? 'lasted ' + dur(i.startedAt, i.resolvedAt) : 'ongoing for ' + dur(i.startedAt, Date.now())}</p></div>
        {canAck(role) && i.status !== 'resolved' && <div className="acts">{i.status === 'open' && <button className="btn" onClick={() => act('acknowledged')}>Acknowledge</button>}<button className="btn pr" onClick={() => act('resolved')}>Resolve</button></div>}</div>
      <div className="card ai"><div className="aih"><i className="spark-ic" /> <b>Pulse AI summary</b><span className="m mono sm">generated from signals, routes, errors and deploys</span></div><p className="sum">{i.summary}</p><div className="sigs">{i.signals.map((s: any, k: number) => <span key={k} className="sig"><b>{s.kind === 'rule' ? s.label : SIG[s.kind]}</b> {s.kind === 'error_rate' ? `${fmtPct(s.baseline)} \u2192 ${fmtPct(s.value)}` : s.kind === 'latency' ? `${fmtMs(s.baseline)} \u2192 ${fmtMs(s.value)}` : s.kind === 'traffic_drop' ? `${s.value.toFixed(0)} vs ${s.baseline.toFixed(0)} per bucket` : ''}</span>)}</div>
        <h4>Suggested next steps</h4><ol className="steps">{i.hints.map((h: string) => <li key={h}>{h}</li>)}</ol></div>
      <div className="card"><h3>Error rate during the incident</h3><LiveChart height={200} lines={[{ name: 'errors', color: '#ff4d6a', data: d.series.map((x: any) => ({ t: x.t, v: x.errRate * 100 })) }]} spans={spans} markers={markers} threshold={5} fmt={n => n.toFixed(0) + '%'} /></div>
      <div className="grid2"><div className="card"><h3>Where it is failing</h3>{i.topRoutes.map((r: any) => <div key={r.route} className="rbar"><span className="mono">{r.route}</span><div><u style={{ width: (r.err / maxRoute) * 100 + '%' }} /></div><b>{r.err} errors</b></div>)}{!i.topRoutes.length && <p className="m">No route data.</p>}
        <h3 style={{ marginTop: 20 }}>Top errors</h3>{i.topIssues.map((t: any) => <TLink key={t.issueId} to={`/app/${pid}/issues/${t.issueId}`} className="irow" data-cur="Open"><b className="mono">{t.title}</b><span className="m mono">{fmtNum(t.count)}x</span></TLink>)}{!i.topIssues.length && <p className="m">No error logs.</p>}</div>
        <div className="card"><h3>Timeline</h3><ol className="tl">{[...i.timeline].reverse().map((e: any, k: number) => <li key={k}><span className="mono m">{clock(e.t)}</span><span>{e.text}</span></li>)}{i.deploy && <li><span className="mono m">before</span><span>Deploy <b>{i.deploy.version}</b> shipped {i.deploy.minsBefore} min earlier.</span></li>}</ol></div></div>
      <div className="card"><h3>Error logs from this window</h3>{d.logs.map((l: any) => <div key={l.id} className="lg error"><span className="mono m">{clock(l.t)}</span><span className="mono m svc">{l.service}</span><span className="msg">{l.message}</span></div>)}{!d.logs.length && <p className="m">None.</p>}</div>
      {d.similar.length > 0 && <section className="rec"><div className="rech"><h3>Similar past incidents</h3><span className="m">Same signals, routes or errors. See how they ended.</span></div><div className="recs">{d.similar.map((s: any) => <TLink key={s.incident.id} to={`/app/${pid}/incidents/${s.incident.id}`} className="card rc" data-cur="Open"><b>{s.incident.title}</b><span className="m">{ago(s.incident.startedAt)} &middot; lasted {dur(s.incident.startedAt, s.incident.resolvedAt || s.incident.startedAt)} &middot; {Math.round(s.score * 100)}% match</span><span className="m sm">{s.incident.summary.slice(0, 120)}...</span></TLink>)}</div></section>}
    </div>
  );
}
