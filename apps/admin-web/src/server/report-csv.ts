export function reportCsv(rows: Record<string, string | number | null>[]): string {
  const escape = (value: string | number | null) => {
    let text = value === null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const keys = Object.keys(rows[0] ?? {});
  return (
    '\ufeff' +
    [
      keys.map((k) => escape(k.replaceAll('_', ' '))).join(','),
      ...rows.map((r) => keys.map((k) => escape(r[k] ?? null)).join(',')),
    ].join('\r\n')
  );
}
