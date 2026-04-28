// Text normalization for fuzzy / forgiving name search.
// Handles emojis, decorative unicode (e.g. mathematical alphabets),
// punctuation, dividers, and whitespace.

// Strip emoji and pictographic characters using Unicode property escapes.
// Falls back gracefully if engine doesn't support some properties.
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0F\u20E3]/gu;

// Variation selectors / zero-width joiners / formatting marks.
const FORMAT_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// Combining diacritical marks (after NFKD).
const COMBINING_RE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

/**
 * Normalize a name for forgiving search:
 *   - Strip emoji
 *   - NFKD decompose (turns `𝓐𝓭𝓶𝓲𝓷` into `Admin`, fullwidth into ASCII, etc.)
 *   - Drop combining marks (so `é` -> `e`)
 *   - Lowercase
 *   - Remove anything that's not [a-z0-9 ] (dots, dashes, dividers like `・`, etc. all become spaces)
 *   - Collapse whitespace
 */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // 1) Drop emoji and formatting marks
  s = s.replace(EMOJI_RE, " ").replace(FORMAT_RE, "");
  // 2) Compatibility decompose: 𝓐 -> A, fullwidth A -> A, ﬁ -> fi, etc.
  s = s.normalize("NFKD");
  // 3) Remove combining marks
  s = s.replace(COMBINING_RE, "");
  // 4) Lowercase
  s = s.toLowerCase();
  // 5) Replace any non [a-z0-9] with space
  s = s.replace(/[^a-z0-9]+/g, " ");
  // 6) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Score a candidate name against a normalized query.
 * Higher = better match. 0 = no match.
 */
export function scoreMatch(candidateRaw: string, queryNorm: string): number {
  if (!queryNorm) return 0;
  const cand = normalizeName(candidateRaw);
  if (!cand) return 0;

  if (cand === queryNorm) return 1000;
  if (cand.startsWith(queryNorm)) return 500 - (cand.length - queryNorm.length);
  if (cand.includes(` ${queryNorm}`)) return 400;
  if (cand.includes(queryNorm)) return 300 - (cand.length - queryNorm.length);

  // Token overlap (each word from query found as a token in candidate)
  const qTokens = queryNorm.split(" ").filter(Boolean);
  const cTokens = new Set(cand.split(" ").filter(Boolean));
  const hits = qTokens.filter((t) => cTokens.has(t)).length;
  if (hits === qTokens.length && qTokens.length > 0) return 200;
  if (hits > 0) return 100 + hits * 10;

  // Partial token: any candidate token starts with query
  for (const t of cTokens) {
    if (t.startsWith(queryNorm)) return 50;
  }
  return 0;
}
