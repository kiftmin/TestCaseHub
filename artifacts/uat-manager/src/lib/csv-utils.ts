export function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  const dangerousFirstChar = /^[=+\-@]/;
  const needsQuoting = /[,"\n\r]/;
  let escaped = str;
  if (dangerousFirstChar.test(escaped)) {
    escaped = "'" + escaped;
  }
  if (needsQuoting.test(escaped)) {
    escaped = '"' + escaped.replace(/"/g, '""') + '"';
  }
  return escaped;
}

export function buildCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",") + "\r\n";
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  let content = buildCsvRow(headers);
  for (const row of rows) {
    content += buildCsvRow(row);
  }
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
