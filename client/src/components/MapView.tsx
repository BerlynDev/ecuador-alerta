import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import type { BBox, Region, Snapshot } from '@ea/shared';
import { REGIONS } from '@ea/shared';
import { categorySvg } from '../icons';
import { hotspotColor, type ColorBy } from '../format';
import type { Selection } from '../types';

interface Props {
  snapshot: Snapshot | null;
  provinces: GeoJSON.FeatureCollection | null;
  regions: Region[];
  province: string | null;
  colorBy: ColorBy;
  selection: Selection;
  onSelect: (s: Selection) => void;
  dark: boolean;
}

function boundsFor(regions: Region[]): L.LatLngBoundsExpression {
  const boxes: BBox[] = regions.map((r) => REGIONS[r].bbox);
  const w = Math.min(...boxes.map((b) => b[0]));
  const s = Math.min(...boxes.map((b) => b[1]));
  const e = Math.max(...boxes.map((b) => b[2]));
  const n = Math.max(...boxes.map((b) => b[3]));
  return [[s, w], [n, e]];
}

/** Moves the camera when filters or the selection change. */
function Camera({ regionsKey, lat, lon }: { regionsKey: string; lat?: number; lon?: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(boundsFor(regionsKey.split(',') as Region[]), { padding: [16, 16] });
  }, [map, regionsKey]);
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo([lat, lon], Math.max(map.getZoom(), 9), { duration: 0.8, animate: !reduceMotion });
  }, [map, lat, lon]);
  return null;
}

const eventIcon = (category: Parameters<typeof categorySvg>[0], open: boolean, selected: boolean) =>
  L.divIcon({
    className: '',
    html: `<span class="pin${open ? '' : ' pin--closed'}${selected ? ' pin--selected' : ''}">${categorySvg(category, 15)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

export function MapView({ snapshot, provinces, regions, province, colorBy, selection, onSelect, dark }: Props) {
  const target = useMemo<[number, number] | null>(() => {
    if (!snapshot || !selection) return null;
    const pool = selection.kind === 'event' ? snapshot.events : selection.kind === 'cluster' ? snapshot.clusters : snapshot.hotspots;
    const hit = pool.find((x) => x.id === selection.id);
    return hit ? [hit.lat, hit.lon] : null;
  }, [snapshot, selection]);

  const clusterMembers = useMemo(() => {
    if (selection?.kind !== 'cluster' || !snapshot) return new Set<string>();
    return new Set(snapshot.clusters.find((c) => c.id === selection.id)?.memberIds ?? []);
  }, [selection, snapshot]);

  // Leaflet draws on <canvas> here, which can't resolve CSS variables: use literal colors.
  const ink = dark ? '#E3ECE8' : '#1E2B2F';
  const boundary = dark ? 'rgba(227,236,232,0.28)' : 'rgba(30,43,47,0.32)';
  const outline = dark ? 'rgba(0,0,0,0.6)' : 'rgba(40,20,10,0.45)';

  const tiles = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  return (
    <MapContainer
      className="map"
      bounds={boundsFor(regions)}
      preferCanvas // thousands of circles render far faster on canvas than as SVG nodes
      zoomControl
      attributionControl
    >
      <TileLayer
        key={tiles}
        url={tiles}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>; datos: NASA FIRMS y NASA EONET; límites: geoBoundaries'
      />
      <Camera regionsKey={regions.join(',')} lat={target?.[0]} lon={target?.[1]} />

      {provinces && (
        <GeoJSON
          key={`${province ?? 'all'}-${dark}`}
          data={provinces}
          style={(f) => {
            const active = province && f?.properties?.name === province;
            return {
              color: active ? ink : boundary,
              weight: active ? 2 : 0.8,
              fillOpacity: active ? 0.06 : 0,
              fillColor: ink,
            };
          }}
          interactive={false}
        />
      )}

      {snapshot?.clusters.map((c) => (
        <Circle
          key={c.id}
          center={[c.lat, c.lon]}
          radius={Math.max(1500, Math.sqrt(c.size) * 900)}
          pathOptions={{
            color: ink,
            weight: selection?.kind === 'cluster' && selection.id === c.id ? 2.5 : 1.2,
            dashArray: '4 4',
            fill: false,
          }}
          eventHandlers={{ click: () => onSelect({ kind: 'cluster', id: c.id }) }}
        />
      ))}

      {snapshot?.hotspots.map((h) => {
        const selected = (selection?.kind === 'hotspot' && selection.id === h.id) || clusterMembers.has(h.id);
        return (
          <CircleMarker
            key={h.id}
            center={[h.lat, h.lon]}
            radius={Math.min(10, 3 + Math.sqrt(h.frp ?? 1))}
            pathOptions={{
              color: selected ? ink : outline,
              weight: selected ? 2 : 0.6,
              fillColor: hotspotColor(h, colorBy),
              fillOpacity: 0.9,
            }}
            eventHandlers={{ click: () => onSelect({ kind: 'hotspot', id: h.id }) }}
          />
        );
      })}

      {snapshot?.events.map((e) => (
        <Marker
          key={e.id}
          position={[e.lat, e.lon]}
          icon={eventIcon(e.category, e.status === 'open', selection?.kind === 'event' && selection.id === e.id)}
          title={e.title}
          keyboard
          eventHandlers={{ click: () => onSelect({ kind: 'event', id: e.id }) }}
          zIndexOffset={1000}
        />
      ))}
    </MapContainer>
  );
}
