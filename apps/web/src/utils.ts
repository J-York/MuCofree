export function formatDateTime(iso: string): string {
  let normalized = iso;
  if (normalized && !normalized.endsWith("Z") && !normalized.includes("+") && !normalized.includes("T")) {
    normalized = normalized.replace(" ", "T") + "Z";
  }
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    new URL(url, window.location.href);
    return url;
  } catch {
    return null;
  }
}
