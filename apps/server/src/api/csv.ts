/** Rows to CSV text. Cells starting with = + - @ get a leading apostrophe so spreadsheets do not run them as formulas. */
export function toCsvRows(rows: unknown[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          let s = v === null || v === undefined ? '' : String(v);
          if (/^[=+@-]/.test(s)) s = `'${s}`;
          return `"${s.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
}
