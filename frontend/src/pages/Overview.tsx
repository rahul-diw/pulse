import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { LiveChart } from '../components/LiveChart';
import { Kpi, Sev, Empty } from '../components/ui';
import { TLink } from '../components/nav';
import { usePoll, fmtMs, fmtPct, fmtNum, ago } from '../util';
import type { Ctx } from './AppLayout';
const rel = (c: number, p: number) => (p ? (c - p) / p : 0);
export default function Overview() {
  const { pid } = useOutletContext<Ctx>(), [range, setRange] = useState(15), { data: ov, err } = usePoll(() => api('GET', `/p/${pid}/overview?minutes=${range}`), 3000, [pid, range]);
  if (err) return <p className="err">{err}</p>; if (!ov) return <div className="skel" />;
  const s = ov.series, k = ov.kpis, spans = ov.openIncidents.map((i: any) => ({ from: i.startedAt, to: Date.now() })), markers = ov.deploys.map((d: any) => ({ t: d.t, label: d.version }));
  return (
    <div>
      <div className="chips">{[5, 15, 60, 180].map(m => <button key={m} className={range === m ? 'on' : ''} onClick={() => setRange(m)}>{m < 60 ? m + ' min' : m / 60 + ' h'}</button>)}<span className="m sm" style={{ marginLeft: 'auto' }}>auto-refresh 3s</span></div>
      <div className="grid4"><Kpi label="Throughput" kind="rate" value={k.rps} delta={rel(k.rps, k.prev.rps)} goodDown={false} sub={<span className="m">{fmtNum(k.req)} requests</span>} /><Kpi label="Error rate" kind="pct" value={k.errRate} delta={rel(k.errRate, k.prev.errRate)} /><Kpi label="p95 latency" kind="ms" value={k.p95} delta={rel(k.p95, k.prev.p95)} /><Kpi label="Open issues" value={ov.issuesOpen} sub={<span className="m">{ov.monitors.total ? `${ov.monitors.up}/${ov.monitors.total} monitors up` : 'no monitors'}</span>} /></div>
      <div className="grid2">
        <div className="card"><h3>Requests per second</h3><LiveChart lines={[{ name: 'req/s', color: '#7c6cff', data: s.map((x: any) => ({ t: x.t, v: x.rate })) }]} spans={spans} markers={markers} fmt={n => n.toFixed(1)} /></div>
        <div className="card"><h3>Error rate</h3><LiveChart lines={[{ name: 'errors', color: '#ff4d6a', data: s.map((x: any) => ({ t: x.t, v: x.req ? (x.err / x.req) * 100 : 0 })) }]} spans={spans} markers={markers} threshold={5} fmt={n => n.toFixed(1) + '%'} /></div>
      </div>
      <div className="card"><h3>Latency <span className="legend"><i style={{ background: '#35d6ff' }} />p50 <i style={{ background: '#ffb84d' }} />p95 <i style={{ background: '#ff4d6a' }} />p99</span></h3><LiveChart height={210} area={false} lines={[{ name: 'p50', color: '#35d6ff', data: s.map((x: any) => ({ t: x.t, v: x.p50 })) }, { name: 'p95', color: '#ffb84d', data: s.map((x: any) => ({ t: x.t, v: x.p95 })) }, { name: 'p99', color: '#ff4d6a', data: s.map((x: any) => ({ t: x.t, v: x.p99 })) }]} spans={spans} markers={markers} fmt={fmtMs} /></div>
      <div className="grid2">
        <div className="card"><h3>Top routes</h3><div className="tw"><table><thead><tr><th>Route</th><th>Req</th><th>Errors</th><th>Avg</th></tr></thead><tbody>{ov.routes.map((r: any) => <tr key={r.route}><td className="mono">{r.route}</td><td>{fmtNum(r.req)}</td><td className={r.err / Math.max(1, r.req) > 0.05 ? 'bad' : ''}>{fmtPct(r.req ? r.err / r.req : 0)}</td><td>{fmtMs(r.avgMs)}</td></tr>)}</tbody></table></div>{!ov.routes.length && <p className="m">No requests yet. Send events with the SDK.</p>}</div>
        <div className="card"><h3>Incidents</h3>{ov.openIncidents.length ? ov.openIncidents.map((i: any) => <TLink key={i.id} to={`/app/${pid}/incidents/${i.id}`} className="irow" data-cur="Open"><Sev s={i.severity} /><b>{i.title}</b><span className="m mono">{ago(i.startedAt)}</span></TLink>) : <div className="allok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg><div><b>All systems normal</b><span className="m">The watchdog is checking every 10 seconds.</span></div></div>}
          <h3 style={{ marginTop: 20 }}>Recent deploys</h3>{ov.deploys.length ? ov.deploys.slice(-4).reverse().map((d: any) => <div key={d.id} className="row2"><span className="mono">{d.version}</span><span className="m">{d.note}</span><span className="m mono">{ago(d.t)}</span></div>) : <p className="m sm">No deploys in this window.</p>}</div>
      </div>
    </div>
  );
}
