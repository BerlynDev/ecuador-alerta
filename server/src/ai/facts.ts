import type { NaturalEvent, Snapshot } from '@ea/shared';
import { EVENT_CATEGORIES, REGIONS } from '@ea/shared';
import { ECUADOR_OFFSET_MS } from '../domain/time.js';

/**
 * Grounding layer for the LLM.
 *
 * The model never sees raw API data and never does arithmetic: every number
 * it may mention is computed here, deterministically, in code we can test.
 * The LLM's only job is to turn these facts into readable Spanish.
 */

/** "8 nov 2026, 14:30 (hora de Ecuador)" — avoids the model converting time zones. */
export function formatLocal(iso: string): string {
  const d = new Date(Date.parse(iso) + ECUADOR_OFFSET_MS);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildSummaryFacts(s: Snapshot) {
  const { hotspots, events, clusters, query } = s;
  const total = hotspots.length;

  const byProvince = new Map<string, number>();
  for (const h of hotspots) byProvince.set(h.province, (byProvince.get(h.province) ?? 0) + 1);
  const ranking = [...byProvince.entries()].sort((a, b) => b[1] - a[1]);

  const high = hotspots.filter((h) => h.confidence === 'high').length;
  const strongest = hotspots.reduce<(typeof hotspots)[number] | null>(
    (best, h) => ((h.frp ?? -1) > (best?.frp ?? -1) ? h : best),
    null,
  );

  return {
    periodo: {
      ultimasHoras: query.hours,
      desde: formatLocal(s.window.from),
      hasta: formatLocal(s.window.to),
      zonaHoraria: 'hora de Ecuador continental (UTC-5)',
    },
    ambito: {
      regiones: query.regions.map((r) => REGIONS[r].label),
      provinciaFiltrada: query.province,
    },
    focosDeCalor: {
      total,
      altaConfianza: high,
      porcentajeAltaConfianza: total ? Math.round((high / total) * 100) : 0,
      provinciasConFocos: ranking.length,
      provinciasPrincipales: ranking.slice(0, 5).map(([provincia, focos]) => ({ provincia, focos })),
      focoMasIntenso: strongest?.frp != null
        ? { provincia: strongest.province, potenciaRadiativaMW: round1(strongest.frp), fecha: formatLocal(strongest.acquiredAt) }
        : null,
      satelites: [...new Set(hotspots.map((h) => h.satellite))],
    },
    agrupacionesPrincipales: clusters.slice(0, 3).map((c) => ({
      provincia: c.province,
      focos: c.size,
      potenciaTotalMW: round1(c.totalFrp),
    })),
    eventosNaturales: events.map(eventFacts),
    tendenciaFocosPorDia: s.daily.map((d) => ({ dia: d.date, focos: d.count })),
    datosDeDemostracion: s.meta.mode === 'mock',
  };
}

export function eventFacts(e: NaturalEvent) {
  return {
    titulo: e.title,
    categoria: EVENT_CATEGORIES[e.category],
    estado: e.status === 'open' ? 'activo' : 'cerrado',
    ultimaActualizacion: formatLocal(e.date),
    cerradoEl: e.closedAt ? formatLocal(e.closedAt) : null,
    provincia: e.province ?? 'fuera de las provincias de Ecuador (zona limítrofe o marítima)',
    magnitud: e.magnitude ? `${e.magnitude.value} ${e.magnitude.unit}` : null,
    descripcion: e.description,
    fuentes: e.sources.map((src) => src.id),
  };
}

export type SummaryFacts = ReturnType<typeof buildSummaryFacts>;
