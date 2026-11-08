import { useState } from 'react';
import type { Snapshot } from '@ea/shared';
import { EVENT_CATEGORIES } from '@ea/shared';
import { categorySvg } from '../icons';
import { fmtNumber, frpColor, relativeTime } from '../format';
import type { Selection } from '../types';

type Tab = 'events' | 'clusters' | 'hotspots';
const MAX_HOTSPOTS = 40;

interface Props {
  snapshot: Snapshot;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export function Lists({ snapshot, selection, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('events');
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  const strongest = [...snapshot.hotspots].sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0)).slice(0, MAX_HOTSPOTS);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'events', label: 'Eventos', count: snapshot.events.length },
    { id: 'clusters', label: 'Agrupaciones', count: snapshot.clusters.length },
    { id: 'hotspots', label: 'Focos', count: snapshot.hotspots.length },
  ];

  return (
    <section className="lists">
      <div className="tabs" role="tablist" aria-label="Listas">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="tab__count">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'events' &&
          (snapshot.events.length === 0 ? (
            <p className="empty">NASA EONET no reporta eventos para estos filtros. Prueba con “7 días” o todas las categorías.</p>
          ) : (
            <ul className="items">
              {snapshot.events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="item" aria-pressed={isSel('event', e.id)} onClick={() => onSelect({ kind: 'event', id: e.id })}>
                    <span className={`glyph glyph--event${e.status === 'open' ? '' : ' glyph--closed'}`} dangerouslySetInnerHTML={{ __html: categorySvg(e.category, 14) }} />
                    <span className="item__main">
                      <span className="item__title">{e.title}</span>
                      <span className="item__meta">
                        {EVENT_CATEGORIES[e.category]}, {e.status === 'open' ? 'activo' : 'cerrado'}
                        {e.province ? ` en ${e.province}` : ', fuera de las provincias'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'clusters' &&
          (snapshot.clusters.length === 0 ? (
            <p className="empty">No hay grupos de 3 o más focos cercanos en este periodo.</p>
          ) : (
            <ul className="items">
              {snapshot.clusters.map((c) => (
                <li key={c.id}>
                  <button type="button" className="item" aria-pressed={isSel('cluster', c.id)} onClick={() => onSelect({ kind: 'cluster', id: c.id })}>
                    <span className="item__num">{c.size}</span>
                    <span className="item__main">
                      <span className="item__title">{c.province}</span>
                      <span className="item__meta">
                        {fmtNumber(c.totalFrp, 0)} MW en total, último {relativeTime(c.lastSeen)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'hotspots' &&
          (snapshot.hotspots.length === 0 ? (
            <p className="empty">No hay focos de calor para estos filtros.</p>
          ) : (
            <>
              <ul className="items">
                {strongest.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="item" aria-pressed={isSel('hotspot', h.id)} onClick={() => onSelect({ kind: 'hotspot', id: h.id })}>
                      <span className="swatch" style={{ background: frpColor(h.frp) }} />
                      <span className="item__main">
                        <span className="item__title">{h.province}</span>
                        <span className="item__meta">
                          {h.frp !== null ? `${fmtNumber(h.frp, 1)} MW` : 'sin FRP'}, {relativeTime(h.acquiredAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {snapshot.hotspots.length > MAX_HOTSPOTS && (
                <p className="empty">Se muestran los {MAX_HOTSPOTS} focos más intensos de {snapshot.hotspots.length}.</p>
              )}
            </>
          ))}
      </div>
    </section>
  );
}
