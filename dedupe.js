// Fuzzy duplicate detection for the dinner list.
//
// The list contains genuinely distinct lookalikes ("Dumpling Home" vs
// "Dumpling Time" vs "Dumpling Union"), so matching is deliberately tight:
// it catches typos, punctuation/spacing/casing variants, and "X" vs
// "X Something" — but it will NOT collapse names that differ by a whole word.

// Lowercase, strip accents & punctuation, collapse spaces, drop a leading "the".
function normalize(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, '') // drop apostrophes, commas, periods, hyphens…
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
}

// Standard Levenshtein edit distance.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Is `short`'s token list a leading subsequence of `long`'s?
// e.g. ["chipotle"] is a prefix of ["chipotle","mexican","grill"].
function isTokenPrefix(short, long) {
  if (short.length >= long.length) return false;
  return short.every((tok, i) => tok === long[i]);
}

// Compares two already-normalized names. Returns true only for high-confidence
// duplicates — never for names that differ by a distinct word.
function fuzzyEqual(na, nb) {
  if (na === nb) return true;

  // Same words run together vs spaced: "sweet green" ↔ "sweetgreen"
  if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return true;

  // A single typo across the whole string: "sweetgreen" ↔ "sweetgreeen"
  // (distance 1 can't reach a real word swap like "home"→"time", which is 2)
  if (levenshtein(na, nb) <= 1) return true;

  const ta = na.split(' ');
  const tb = nb.split(' ');

  // "Chipotle" ↔ "Chipotle Mexican Grill", "Baked Bear" ↔ "The Baked Bear"
  if (isTokenPrefix(ta, tb) || isTokenPrefix(tb, ta)) return true;

  // Same number of words, each word identical or a 1-char typo of its pair.
  // "Marufuku Ramen" ↔ "Marafuku Ramen", but NOT "Dumpling Home" ↔ "Dumpling Time"
  // (home→time is distance 2, so it stays distinct).
  if (ta.length === tb.length) {
    const everyWordMatches = ta.every((tok, i) => {
      const other = tb[i];
      if (tok === other) return true;
      return tok.length >= 4 && other.length >= 4 && levenshtein(tok, other) <= 1;
    });
    if (everyWordMatches) return true;
  }

  return false;
}

// Finds an existing entry that duplicates `name`.
// Returns { restaurant, exact } or null. `exact` distinguishes a normalized
// exact hit (safe to silently treat as the same) from a fuzzy near-match
// (worth surfacing to the user before adding).
function findMatch(name, restaurants) {
  const nc = normalize(name);
  const exact = restaurants.find(r => normalize(r.name) === nc);
  if (exact) return { restaurant: exact, exact: true };
  const fuzzy = restaurants.find(r => fuzzyEqual(nc, normalize(r.name)));
  return fuzzy ? { restaurant: fuzzy, exact: false } : null;
}

module.exports = { normalize, levenshtein, fuzzyEqual, findMatch };
