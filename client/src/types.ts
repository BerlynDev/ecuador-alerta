export type Selection =
  | { kind: 'event'; id: string }
  | { kind: 'cluster'; id: string }
  | { kind: 'hotspot'; id: string }
  | null;
