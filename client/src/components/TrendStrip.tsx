import type { DailyCount } from '@ea/shared';
import { fmtDay, frpColor, HEAT } from '../format';

/**
 * 7-day trend as a "thermal strip": plain SVG bars, no chart library.
 * Bar colour follows the same heat ramp as the map so the chart reads as
 * part of the same visual language. Today's bar is partial and is marked as such.
 */
export function TrendStrip({ daily }: { daily: DailyCount[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const W = 320;
  const H = 96;
  const TOP = 16; // room for the value label above the tallest bar
  const gap = 6;
  const barW = (W - gap * (daily.length - 1)) / daily.length;

  // Darker bars for busier days: map count to the ramp by share of the max.
  const color = (c: number) => (c === 0 ? 'var(--line)' : c / max > 0.75 ? HEAT[3] : frpColor((c / max) * 60));

  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${TOP + H + 22}`} role="img" aria-label="Focos de calor por día, últimos 7 días">
        {daily.map((d, i) => {
          const h = Math.max(2, (d.count / max) * H);
          const x = i * (barW + gap);
          const today = i === daily.length - 1;
          return (
            <g key={d.date}>
              <title>{`${fmtDay(d.date)}: ${d.count} focos${today ? ' (día en curso)' : ''}`}</title>
              <rect x={x} y={TOP + H - h} width={barW} height={h} rx={2} fill={color(d.count)} opacity={today ? 0.55 : 1} />
              <text x={x + barW / 2} y={TOP + H - h - 5} textAnchor="middle" className="trend__value">
                {d.count}
              </text>
              <text x={x + barW / 2} y={TOP + H + 16} textAnchor="middle" className="trend__day">
                {fmtDay(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>Focos por día (hora de Ecuador). La última barra es el día en curso.</figcaption>
    </figure>
  );
}
