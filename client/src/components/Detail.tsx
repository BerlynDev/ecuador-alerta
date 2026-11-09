import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@ea/shared';
import { EVENT_CATEGORIES } from '@ea/shared';
import { api } from '../api';
import { categorySvg } from '../icons';
import { CONFIDENCE_LABEL, fmtDateTime, fmtNumber, frpColor } from '../format';
import type { Selection } from '../types';
import { AiBlock, type AiState } from './AiBlock';

interface Props {
  snapshot: Snapshot;
  selection: NonNullable<Selection>;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Detail({ snapshot, selection, onClose, onSelect }: Props) {
  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  const ref = useRef<HTMLElement>(null);
  // Same guard as the daily summary: ignore explanations for a previous selection.
  const explainRequest = useRef(0);
  useEffect(() => {
    explainRequest.current++;
    setAi({ status: 'idle' });
    // A click on the map should reveal the detail even if the panel is scrolled.
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selection.kind, selection.id]);

  const explain = (id: string) => {
    const req = ++explainRequest.current;
    setAi({ status: 'loading' });
    api.explain(id).then(
      (result) => req === explainRequest.current && setAi({ status: 'done', result }),
      (err: Error) => req === explainRequest.current && setAi({ status: 'error', message: err.message }),
    );
  };

  let body: React.ReactNode = <p>Este elemento ya no está en la vista actual.</p>;
  let title = 'Detalle';

  if (selection.kind === 'event') {
    const e = snapshot.events.find((x) => x.id === selection.id);
    if (e) {
      title = e.title;
      body = (
        <>
          <p className="detail__kind">
            <span className="glyph" dangerouslySetInnerHTML={{ __html: categorySvg(e.category, 14) }} />
            {EVENT_CATEGORIES[e.category]}, {e.status === 'open' ? 'activo' : 'cerrado'}
          </p>
          <dl>
            <Row label="Provincia">{e.province ?? 'Fuera de las provincias (zona limítrofe o marítima)'}</Row>
            <Row label="Última actualización">{fmtDateTime(e.date)}</Row>
            {e.closedAt && <Row label="Cerrado">{fmtDateTime(e.closedAt)}</Row>}
            {e.magnitude && <Row label="Magnitud">{`${fmtNumber(e.magnitude.value, 0)} ${e.magnitude.unit}`}</Row>}
            <Row label="Fuentes">
              {e.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ', '}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.id}
                  </a>
                </span>
              ))}
            </Row>
          </dl>
          {ai.status === 'idle' && (
            <button type="button" className="btn" onClick={() => explain(e.id)}>
              Explicar este evento
            </button>
          )}
          <AiBlock state={ai} onRetry={() => explain(e.id)} />
        </>
      );
    }
  }

  if (selection.kind === 'cluster') {
    const c = snapshot.clusters.find((x) => x.id === selection.id);
    if (c) {
      title = `Agrupación de ${c.size} focos`;
      body = (
        <>
          <p className="detail__kind">Focos a menos de 2 km entre sí: probablemente un mismo incendio o zona de quema.</p>
          <dl>
            <Row label="Provincia">{c.province}</Row>
            <Row label="Potencia total">{`${fmtNumber(c.totalFrp, 1)} MW`}</Row>
            <Row label="Foco más intenso">{`${fmtNumber(c.maxFrp, 1)} MW`}</Row>
            <Row label="Primera detección">{fmtDateTime(c.firstSeen)}</Row>
            <Row label="Última detección">{fmtDateTime(c.lastSeen)}</Row>
            <Row label="Centro">{`${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`}</Row>
          </dl>
        </>
      );
    }
  }

  if (selection.kind === 'hotspot') {
    const h = snapshot.hotspots.find((x) => x.id === selection.id);
    if (h) {
      const cluster = snapshot.clusters.find((c) => c.memberIds.includes(h.id));
      title = `Foco de calor en ${h.province}`;
      body = (
        <>
          <p className="detail__kind">
            <span className="swatch" style={{ background: frpColor(h.frp) }} />
            Detección {h.instrument} del satélite {h.satellite}, {h.dayNight === 'D' ? 'de día' : 'de noche'}
          </p>
          <dl>
            <Row label="Detectado">{fmtDateTime(h.acquiredAt)}</Row>
            <Row label="Potencia radiativa (FRP)">{h.frp !== null ? `${fmtNumber(h.frp, 1)} MW` : 'Sin dato'}</Row>
            <Row label="Confianza">{CONFIDENCE_LABEL[h.confidence]}</Row>
            {h.brightnessK !== null && <Row label="Temperatura de brillo">{`${fmtNumber(h.brightnessK, 0)} K`}</Row>}
            <Row label="Coordenadas">{`${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}`}</Row>
          </dl>
          {cluster && (
            <button type="button" className="link" onClick={() => onSelect({ kind: 'cluster', id: cluster.id })}>
              Ver la agrupación de {cluster.size} focos
            </button>
          )}
        </>
      );
    }
  }

  return (
    <section ref={ref} className="detail" aria-labelledby="detail-title">
      <header className="detail__head">
        <h2 id="detail-title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar detalle">
          ×
        </button>
      </header>
      {body}
    </section>
  );
}
