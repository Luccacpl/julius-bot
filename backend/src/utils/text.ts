export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteUrl(value: string | undefined, origin: string) {
  if (!value) return origin;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  return `${origin}/${value}`;
}

export function formatCount(value: number) {
  return value.toLocaleString("pt-BR");
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest} s`;
  return `${minutes} min ${rest} s`;
}

export function cleanPackageSize(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = decodeHtml(value)
    .replace(/\s*-\s*compre e ganhe.*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}
