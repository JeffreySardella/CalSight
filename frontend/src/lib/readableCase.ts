// Crash popup fields (road, weather, lighting) come straight from the source
// system as raw uppercase strings, e.g. "BLACKSTONE AVE", "DARK-STREET
// LIGHTS". Display-only formatting to sentence case, so it reads like normal
// text instead of a shouted database dump.
const ROUTE_RE = /\b(?:SR|US|I|CA|HWY)-\d+[A-Z]?\b/g;

const ROAD_ABBR = new Map([
  ["ave", "Ave"], ["st", "St"], ["blvd", "Blvd"], ["hwy", "Hwy"],
  ["rd", "Rd"], ["dr", "Dr"], ["ln", "Ln"], ["ct", "Ct"],
  ["pkwy", "Pkwy"], ["fwy", "Fwy"],
]);

/** Formats a raw uppercase source-system string for display: sentence case,
 *  with route numbers (SR-99, I-5) kept uppercase and common road
 *  abbreviations (Ave, St, Blvd, Hwy, ...) restored to their usual case. */
export function toReadableCase(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw.trim();
  if (!text) return "";

  // Protect route numbers from case-folding by swapping them for a
  // lowercase-safe placeholder token, restored verbatim at the end.
  const routes: string[] = [];
  const withPlaceholders = text.replace(ROUTE_RE, (m) => {
    const token = `@@rt${routes.length}@@`;
    routes.push(m.toUpperCase());
    return token;
  });

  // Space out a bare hyphen (e.g. "DARK-STREET" -> "DARK - STREET") so the
  // two clauses read as separate words instead of running together.
  const spaced = withPlaceholders.replace(/\s*-\s*/g, " - ");

  const lower = spaced.toLowerCase();
  const sentenceCased = lower.replace(/^[a-z]/, (c) => c.toUpperCase());
  const withAbbr = sentenceCased.replace(/\b[a-z]+\b/g, (word) => ROAD_ABBR.get(word) ?? word);

  return routes.reduce((s, route, i) => s.split(`@@rt${i}@@`).join(route), withAbbr);
}
