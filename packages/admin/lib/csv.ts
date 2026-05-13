/**
 * CSV 导出：RFC 4180 风格转义、多行拼接与浏览器下载（带 UTF-8 BOM 便于 Excel）。
 */

/** 单元格转义：含引号/逗号/换行时加双引号并内嵌引号加倍。 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 二维字符串数组 → CRLF 分隔的 CSV 文本。 */
export function csvRowsToString(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/** 浏览器侧触发下载；`\uFEFF` 前缀便于 Excel 识别 UTF-8。 */
export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 文件名安全时间戳（ISO 前缀，冒号改为 `-`）。 */
export function filenameTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
