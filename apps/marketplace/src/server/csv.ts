/**
 * CSV for exports a human opens in a spreadsheet. Two things matter more than
 * formatting: RFC 4180 quoting, and neutralising spreadsheet formulas. A cell
 * that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a
 * single quote so Excel/Sheets treats it as text instead of executing it — the
 * note on a ledger row can contain a job title, which is user input.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  if (/[",\n\r]/u.test(text)) text = `"${text.replace(/"/gu, '""')}"`;
  return text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  return [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(","))
    .join("\r\n")
    .concat("\r\n");
}
