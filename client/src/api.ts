import type { AiText, Snapshot, SnapshotQuery } from '@ea/shared';

/** Thin typed wrapper around the backend. The browser never talks to NASA or the LLM directly. */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function toParams(q: SnapshotQuery): Record<string, string> {
  const p: Record<string, string> = { hours: String(q.hours), regions: q.regions.join(',') };
  if (q.categories) p.categories = q.categories.join(',');
  if (q.province) p.province = q.province;
  if (!q.includeHotspots) p.hotspots = '0';
  return p;
}

export const api = {
  snapshot: (q: SnapshotQuery, signal?: AbortSignal) =>
    request<Snapshot>(`/api/snapshot?${new URLSearchParams(toParams(q))}`, { signal }),

  provinces: () => request<GeoJSON.FeatureCollection>('/api/provinces'),

  summary: (q: SnapshotQuery) =>
    request<AiText>('/api/ai/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toParams(q)),
    }),

  explain: (eventId: string) => request<AiText>(`/api/ai/explain/${encodeURIComponent(eventId)}`, { method: 'POST' }),
};
