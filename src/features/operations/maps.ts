export function operationMapFromEntries<T = unknown>(
  entries: Iterable<readonly [PropertyKey, T]> = [],
): Record<string, T> {
  // Operation names and refs are developer-controlled contract keys. Keep maps
  // null-prototype so "__proto__" and "constructor" stay data keys instead of
  // resolving inherited Object.prototype members during dynamic lookup.
  const map: Record<string, T> = Object.create(null);
  for (const [key, value] of entries) {
    map[String(key)] = value;
  }
  return map;
}
