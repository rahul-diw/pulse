import { useState, type ReactNode } from 'react';
export default function Tabs({ items, initial, onChange, value }: { items: [string, string, ReactNode][]; initial?: string; onChange?: (k: string) => void; value?: string }) {
  const [k0, setK] = useState(initial && items.some(i => i[0] === initial) ? initial : items[0][0]), k = value && items.some(i => i[0] === value) ? value : k0;
  return (
    <div className="tabs">
      <div className="tbar" role="tablist">{items.map(i => <button key={i[0]} role="tab" aria-selected={k === i[0]} className={k === i[0] ? 'on' : ''} onClick={() => { setK(i[0]); onChange?.(i[0]) }}>{i[1]}</button>)}</div>
      {items.map(i => k === i[0] && <div key={i[0]} className="tpanel">{i[2]}</div>)}
    </div>
  );
}
