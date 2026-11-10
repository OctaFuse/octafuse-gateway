/** HTML upstream errors are readable summaries here; full payloads belong to request details. */
export function dashboardErrorSummary(message: string | null | undefined, fallback: string): string {
  if (!message?.trim()) return fallback;
  if (/<(?:!doctype|html|head|body)[\s>]/i.test(message)) {
    const status = message.match(/\bHTTP\s+\d{3}\b/i)?.[0];
    return status ? `${status} · ${fallback}` : fallback;
  }
  return message.replace(/\s+/g, ' ').trim();
}
