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

export function downloadExcel(filename: string, headers: string[], data: unknown[][]): void {
  import("xlsx").then((XLSX) => {
    const rows = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(rows);

    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(
        h.length,
        ...data.map((row) => String(row[i] ?? "").length)
      );
      return { wch: Math.min(Math.max(maxLen + 2, 12), 50) };
    });
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
  });
}

export function downloadDefectsExcel(
  filename: string,
  defects: { id: number; title: string; status: string; severity: string | null; environment?: string; assignee: string; targetRelease: string }[]
): void {
  const headers = ["Defect ID", "Title", "State", "Severity", "Environment", "Assignee", "Target Release"];
  const data = defects.map((d) => [
    `DEF-${d.id}`,
    d.title,
    d.status,
    d.severity ?? "",
    d.environment ?? "",
    d.assignee,
    d.targetRelease,
  ]);
  downloadExcel(filename, headers, data);
}

export function downloadAuditExcel(
  filename: string,
  entries: { timestamp: string; user: string; actionType: string; entityAffected: string; priorState: string; postState: string }[]
): void {
  const headers = ["Timestamp", "User", "Action Type", "Entity Affected", "Prior State", "Post State"];
  const data = entries.map((e) => [
    new Date(e.timestamp).toLocaleString(),
    e.user,
    e.actionType,
    e.entityAffected,
    e.priorState,
    e.postState,
  ]);
  downloadExcel(filename, headers, data);
}
