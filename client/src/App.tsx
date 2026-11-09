import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventCategory, Snapshot, SnapshotQuery, TimeWindow } from '@ea/shared';
import { EVENT_CATEGORIES } from '@ea/shared';
import { api } from './api';
import { MapView } from './components/MapView';
import { TrendStrip } from './components/TrendStrip';
import { Lists } from './components/Lists';
import { Detail } from './components/Detail';
import { AiBlock, type AiState } from './components/AiBlock';
import { CONFIDENCE_COLOR, CONFIDENCE_LABEL, FRP_BREAKS, fmtNumber, HEAT, relativeTime, type ColorBy } from './format';
import type { Selection } from './types';

const WINDOWS: { hours: TimeWindow; label: string }[] = [
  { hours: 24, label: '24 h' },
  { hours: 48, label: '48 h' },
  { hours: 168, label: '7 días' },
];

/** "VIIRS_NOAA20_NRT" → "NOAA-20" */
const sourceLabel = (s: string) => s.replace(/^VIIRS_|^MODIS_|_NRT$|_SP$/g, '').replace(/^NOAA(\d+)$/, 'NOAA-$1').replace('SNPP', 'Suomi NPP');

// Categories that realistically occur in Ecuador go first in the filter.
const CATEGORY_ORDER: EventCategory[] = ['wildfires', 'volcanoes', 'floods', 'landslides', 'severeStorms', 'earthquakes', 'drought', 'dustHaze'];

function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export default function App() {
  const [query, setQuery] = useState<SnapshotQuery>({
    hours: 24,
    regions: ['continental'],
    categories: null,
    province: null,
    includeHotspots: true,
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [provinces, setProvinces] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('frp');
  const [summary, setSummary] = useState<AiState>({ status: 'idle' });
  // Id of the latest summary request. A reply is shown only if it is still the
  // latest, so a slow summary can't land under filters it wasn't written for.
  const summaryRequest = useRef(0);
  const dark = usePrefersDark();

  useEffect(() => {
    api.provinces().then(setProvinces, () => setProvinces(null));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api.snapshot(query, ctrl.signal).then(
      (s) => {
        setSnapshot(s);
        setLoading(false);
      },
      (err: Error) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
      },
    );
    // A summary describes one specific filter state: drop it, and any in flight.
    summaryRequest.current++;
    setSummary({ status: 'idle' });
    return () => ctrl.abort();
  }, [query, reloadKey]);

  const update = useCallback((patch: Partial<SnapshotQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
    setSelection(null);
  }, []);

  const runSummary = () => {
    const id = ++summaryRequest.current;
    setSummary({ status: 'loading' });
    api.summary(query).then(
      (result) => id === summaryRequest.current && setSummary({ status: 'done', result }),
      (err: Error) => id === summaryRequest.current && setSummary({ status: 'error', message: err.message }),
    );
  };

  const provinceNames = (provinces?.features ?? [])
    .map((f) => String(f.properties?.name))
    .filter((n) => query.regions.includes('galapagos') || n !== 'Galápagos');
  const activeEvents = snapshot?.events.filter((e) => e.status === 'open').length ?? 0;
  const windowLabel = WINDOWS.find((w) => w.hours === query.hours)!.label;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Ecuador Alerta</h1>
          <p>Incendios y eventos naturales, con datos satelitales de la NASA</p>
        </div>

        <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
          <fieldset className="segmented">
            <legend className="sr-only">Periodo</legend>
            {WINDOWS.map((w) => (
              <label key={w.hours} className={query.hours === w.hours ? 'is-on' : ''}>
                <input type="radio" name="hours" checked={query.hours === w.hours} onChange={() => update({ hours: w.hours })} />
                {w.label}
              </label>
            ))}
          </fieldset>

          <label className="field">
            <span>Evento</span>
            <select
              value={query.categories?.[0] ?? ''}
              onChange={(e) => update({ categories: e.target.value ? [e.target.value as EventCategory] : null })}
            >
              <option value="">Todos</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {EVENT_CATEGORIES[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Provincia</span>
            <select value={query.province ?? ''} onChange={(e) => update({ province: e.target.value || null })}>
              <option value="">Todo el país</option>
              {provinceNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={query.regions.includes('galapagos')}
              onChange={(e) =>
                update({
                  regions: e.target.checked ? ['continental', 'galapagos'] : ['continental'],
                  province: !e.target.checked && query.province === 'Galápagos' ? null : query.province,
                })
              }
            />
            Galápagos
          </label>

          <label className="check">
            <input type="checkbox" checked={query.includeHotspots} onChange={(e) => update({ includeHotspots: e.target.checked })} />
            Focos de calor
          </label>
        </form>
      </header>

      {snapshot?.meta.mode === 'mock' && (
        <p className="banner banner--demo" role="note">
          Datos de demostración: el servidor no está conectado a la NASA. Configura <code>DATA_MODE=live</code> y una clave de FIRMS para ver datos reales.
        </p>
      )}
      {snapshot && snapshot.meta.warnings.length > 0 && (
        <p className="banner banner--warn" role="status">
          Algunas fuentes no respondieron; los datos pueden estar incompletos. {snapshot.meta.warnings[0]}
        </p>
      )}

      <main className="layout">
        <div className="map-wrap" aria-busy={loading}>
          <MapView
            snapshot={snapshot}
            provinces={provinces}
            regions={query.regions}
            province={query.province}
            colorBy={colorBy}
            selection={selection}
            onSelect={setSelection}
            dark={dark}
          />
          {loading && <div className="map-loading">Cargando datos…</div>}

          <div className="legend">
            <div className="legend__switch" role="group" aria-label="Color de los focos">
              <button type="button" aria-pressed={colorBy === 'frp'} onClick={() => setColorBy('frp')}>
                Intensidad
              </button>
              <button type="button" aria-pressed={colorBy === 'confidence'} onClick={() => setColorBy('confidence')}>
                Confianza
              </button>
            </div>
            <ul>
              {colorBy === 'frp'
                ? HEAT.map((c, i) => (
                    <li key={c}>
                      <span className="swatch" style={{ background: c }} />
                      {i === 0 ? `< ${FRP_BREAKS[0]} MW` : i === HEAT.length - 1 ? `≥ ${FRP_BREAKS[i - 1]} MW` : `${FRP_BREAKS[i - 1]}–${FRP_BREAKS[i]} MW`}
                    </li>
                  ))
                : (['low', 'nominal', 'high'] as const).map((k) => (
                    <li key={k}>
                      <span className="swatch" style={{ background: CONFIDENCE_COLOR[k] }} />
                      {CONFIDENCE_LABEL[k]}
                    </li>
                  ))}
              <li>
                <span className="swatch swatch--ring" />
                Agrupación de focos
              </li>
              <li>
                <span className="swatch swatch--event" />
                Evento natural (EONET)
              </li>
            </ul>
          </div>
        </div>

        <aside className="panel" aria-label="Situación y detalle">
          {error && (
            <div className="banner banner--error" role="alert">
              {error}{' '}
              <button type="button" className="link" onClick={() => setReloadKey((k) => k + 1)}>
                Reintentar
              </button>
            </div>
          )}

          {snapshot && (
            <>
              <section className="situation">
                <div className="figures">
                  <p className="figure">
                    <strong>{fmtNumber(snapshot.hotspots.length)}</strong>
                    <span>focos de calor en {windowLabel}</span>
                  </p>
                  <p className="figure figure--events">
                    <strong>{activeEvents}</strong>
                    <span>{activeEvents === 1 ? 'evento activo' : 'eventos activos'}</span>
                  </p>
                </div>
                <p className="updated">
                  {query.province ?? (query.regions.length > 1 ? 'Ecuador continental y Galápagos' : 'Ecuador continental')}. Datos
                  actualizados {relativeTime(snapshot.meta.fetchedAt)}
                  {snapshot.meta.stale ? ' (en caché: la NASA no respondió)' : ''}.
                </p>

                {summary.status === 'idle' && (
                  <button type="button" className="btn btn--primary" onClick={runSummary}>
                    Resumen del día
                  </button>
                )}
                <AiBlock state={summary} onRetry={runSummary} />
              </section>

              {selection && (
                <Detail snapshot={snapshot} selection={selection} onClose={() => setSelection(null)} onSelect={setSelection} />
              )}

              {query.includeHotspots && <TrendStrip daily={snapshot.daily} />}

              <Lists snapshot={snapshot} selection={selection} onSelect={setSelection} />

              <footer className="credits">
                Fuentes: <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a> (VIIRS{' '}
                {snapshot.meta.firmsSources.map(sourceLabel).join(' y ') || 'sin datos'}) y{' '}
                <a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">NASA EONET</a>. Un foco de calor es una
                anomalía térmica detectada por satélite: puede ser un incendio, una quema agrícola o una fuente industrial. Para
                alertas oficiales, consulta a la{' '}
                <a href="https://www.gestionderiesgos.gob.ec/" target="_blank" rel="noreferrer">
                  Secretaría Nacional de Gestión de Riesgos
                </a>
                .
              </footer>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
