// Flatten a record's name and all descriptive string content into one blob
// (Uses full-text search: full-text over name and all descriptive fields).
export function recordSearchText(name: string, body: unknown): string {
  const parts: string[] = [name || ""];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        parts.push(k);
        walk(v);
      }
    }
  };
  walk(body ?? {});
  return parts.filter(Boolean).join(" ");
}
