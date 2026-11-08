import type { EventCategory, NaturalEvent } from '@ea/shared';
import { EVENT_CATEGORIES } from '@ea/shared';
import type { SummaryFacts } from './facts.js';
import { formatLocal } from './facts.js';

/**
 * Deterministic texts used when no LLM is configured, when the LLM fails,
 * or when its output doesn't pass number verification. The app is fully
 * useful without AI; AI only improves readability.
 */

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;

export function templateSummary(f: SummaryFacts): string {
  const where = f.ambito.provinciaFiltrada ?? list(f.ambito.regiones);
  const parts: string[] = [];
  if (f.datosDeDemostracion) parts.push('Datos de demostración:');

  const h = f.focosDeCalor;
  if (h.total === 0) {
    parts.push(`No se registraron focos de calor en ${where} en las últimas ${f.periodo.ultimasHoras} horas.`);
  } else {
    const top = h.provinciasPrincipales.map((p) => `${p.provincia} (${p.focos})`);
    parts.push(
      `En las últimas ${f.periodo.ultimasHoras} horas, los satélites detectaron ${h.total} ${h.total === 1 ? 'foco' : 'focos'} de calor en ${where}` +
        (f.ambito.provinciaFiltrada ? '.' : `, principalmente en ${list(top)}.`),
    );
    parts.push(`${h.altaConfianza} de ellos (${h.porcentajeAltaConfianza} %) son detecciones de alta confianza.`);
    const big = f.agrupacionesPrincipales[0];
    if (big) parts.push(`La mayor agrupación reúne ${big.focos} focos cercanos en ${big.provincia}.`);
  }

  const active = f.eventosNaturales.filter((e) => e.estado === 'activo');
  if (active.length === 0) {
    parts.push('NASA EONET no reporta eventos naturales activos en la zona.');
  } else {
    const names = active.map((e) => `${e.titulo} (${e.categoria.toLowerCase()})`);
    parts.push(`Eventos naturales activos según NASA EONET: ${list(names)}.`);
  }

  parts.push(
    'Un foco de calor es una detección térmica satelital: puede ser un incendio, una quema agrícola o una fuente industrial, no necesariamente un incendio confirmado.',
  );
  return parts.join(' ');
}

const CATEGORY_TEXT: Record<EventCategory, string> = {
  volcanoes:
    'Un volcán en actividad puede emitir ceniza, gases y flujos de lava o de lodo (lahares). La caída de ceniza afecta la salud respiratoria, los cultivos, el agua y el tráfico aéreo, incluso lejos del volcán.',
  wildfires:
    'Un incendio forestal es fuego que se propaga sin control por la vegetación. Empeora la calidad del aire, destruye ecosistemas y puede amenazar viviendas y cultivos cercanos, sobre todo en época seca.',
  floods:
    'Una inundación ocurre cuando el agua cubre zonas normalmente secas por lluvias intensas o desbordes de ríos. Puede dañar viviendas, vías y cultivos, y aumenta el riesgo de enfermedades transmitidas por el agua.',
  landslides:
    'Un deslizamiento es el movimiento de tierra, roca o lodo pendiente abajo, a menudo después de lluvias fuertes. Puede bloquear carreteras y poner en riesgo a viviendas construidas en laderas.',
  severeStorms:
    'Una tormenta severa trae lluvias intensas, vientos fuertes y descargas eléctricas. Puede provocar inundaciones, deslizamientos y cortes de servicios.',
  earthquakes:
    'Un sismo es una sacudida del terreno causada por la liberación de energía en la corteza terrestre. Ecuador está en una zona de alta actividad sísmica, por lo que conviene conocer las rutas de evacuación.',
  drought:
    'Una sequía es un periodo prolongado con lluvias por debajo de lo normal. Afecta la agricultura, el ganado, el agua potable y la generación hidroeléctrica.',
  dustHaze:
    'El polvo y la bruma son partículas suspendidas en el aire que reducen la visibilidad y afectan la salud respiratoria, especialmente de niños y adultos mayores.',
  manmade:
    'Es un evento de gran magnitud causado por actividad humana, como un derrame o un incendio industrial, con posibles efectos sobre la salud y el ambiente.',
  seaLakeIce: 'Se refiere a cambios en el hielo de mares o lagos, poco habituales en Ecuador.',
  snow: 'Se refiere a nevadas inusuales por su intensidad o época, que pueden afectar vías y cultivos de altura.',
  tempExtremes:
    'Son temperaturas inusualmente altas o bajas que pueden afectar la salud, los cultivos y la demanda de energía.',
  waterColor:
    'Es un cambio visible en el color del agua, por ejemplo por sedimentos o proliferación de algas, que puede indicar problemas de calidad del agua.',
};

export function templateExplanation(e: NaturalEvent): string {
  const status = e.status === 'open' ? 'Sigue activo' : `Se cerró el ${formatLocal(e.closedAt!)}`;
  const place = e.province ? `en la provincia de ${e.province}` : 'fuera de las provincias de Ecuador, en una zona limítrofe o marítima';
  const official =
    e.category === 'volcanoes' || e.category === 'earthquakes'
      ? 'la Secretaría Nacional de Gestión de Riesgos (SNGR) y el Instituto Geofísico de la EPN (IG-EPN)'
      : 'la Secretaría Nacional de Gestión de Riesgos (SNGR)';
  return [
    `${e.title} (${EVENT_CATEGORIES[e.category].toLowerCase()}), ${place}.`,
    CATEGORY_TEXT[e.category],
    `${status}; última actualización: ${formatLocal(e.date)}.`,
    `Para alertas y recomendaciones, sigue la información oficial de ${official}.`,
  ].join(' ');
}
