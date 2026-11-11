/** 0 -> "0", 420 -> "<1k", 3_400 -> "3.4k", 48_000 -> "48k", 1_250_000 -> "1.3M". */
export function formatTokens(tokens: number): string {
  if (tokens <= 0) return "0";
  if (tokens < 1000) return "<1k";
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function relativeTime(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "/Users/ana/src/web" -> "web". */
export function baseName(fullPath: string): string {
  return fullPath.split(/[/\\]/).filter(Boolean).pop() ?? "";
}

/** Replaces the home directory prefix with "~" for display. */
export function tildify(fullPath: string): string {
  return fullPath.replace(/^\/(Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}
