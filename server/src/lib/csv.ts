/**
 * Minimal CSV parser for FIRMS responses.
 *
 * FIRMS CSV is machine-generated: comma-separated, a header row, no quoted
 * fields, no embedded commas. A 15-line parser is easier to read and test
 * than pulling in a general-purpose dependency.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const [headerLine, ...rows] = lines;
  if (!headerLine) return [];

  const headers = headerLine.split(',').map((h) => h.trim());
  return rows.map((line) => {
    const cells = line.split(',');
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (cells[i] ?? '').trim();
    });
    return record;
  });
}
