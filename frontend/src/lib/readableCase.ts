// Crash popup fields (road, weather, lighting) come straight from the source
// system as raw uppercase strings, e.g. "BLACKSTONE AVE", "DARK-STREET
// LIGHTS". Display-only formatting so they read like text, not a database dump.

// A route designation stays uppercase: SR-99, I-5, US-101, CA-1.
const ROUTE_WORD = /^(?:SR|US|I|CA)-?\d+[A-Z]?$/i;

/** Road names in title case ("Mount Whitney Ave"), routes kept as-is. */
export function toRoadName(raw: string | null | undefined): string {
  const text = raw?.trim();
  if (!text) return "";
  return text
    .split(/(\s+)/)
    .map((w) => (ROUTE_WORD.test(w) ? w.toUpperCase() : w.toLowerCase().replace(/(^|[-'/])([a-z])/g, (_, p, c) => p + c.toUpperCase())))
    .join("");
}

/** Category values in sentence case; "DARK-STREET LIGHTS" -> "Dark - street lights". */
export function toReadableCase(raw: string | null | undefined): string {
  const text = raw?.trim();
  if (!text) return "";
  const s = text.replace(/\s*-\s*/g, " - ").toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
}
