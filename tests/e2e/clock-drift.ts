// Pure helper (no Playwright import) so it can be unit-tested with Vitest:
// tests/unit/clock-drift.test.ts.

/** Durations as the risk engine writes them (src/lib/domain/risk.ts `minutes()`): "45 min", "2 h", "2 h 4 min". */
const DURATION = /(\d+) h (\d+) min|(\d+) h|(\d+) min/g;
const toMinutes = (m: RegExpMatchArray | string[]) => (m[1] ? +m[1] * 60 + +m[2] : m[3] ? +m[3] * 60 : +m[4]);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Checks that `text` contains `reason` word for word, except that the durations in it may have
 * moved on by the time that has passed since the reason was read from the API.
 *
 * Why: delay-risk reasons are recalculated from the current time on every request
 * ("Projected to arrive 2 h 4 min after the expected time"). When a minute boundary passes
 * between reading the API and rendering the page, the page is right to say "2 h 5 min".
 * Every other word and number must still match exactly.
 *
 * Returns null when it matches, or a description of the mismatch (for a readable failure).
 */
export function matchReasonAllowingClockDrift(text: string, reason: string, readAt: number, now = Date.now()): string | null {
  const expected = [...reason.matchAll(DURATION)].map(toMinutes);
  if (expected.length === 0) return text.includes(reason) ? null : `"${reason}" not found`;
  const pattern = new RegExp(escapeRegExp(reason).replace(/\d+ h \d+ min|\d+ h|\d+ min/g, () => "(\\d+ h \\d+ min|\\d+ h|\\d+ min)"));
  const found = pattern.exec(text);
  if (!found) return `no text with the shape of "${reason}"`;
  const allowed = Math.ceil((now - readAt) / 60_000) + 1; // whole minutes elapsed, +1 for rounding at both ends
  for (let i = 0; i < expected.length; i++) {
    const shown = toMinutes([...found[i + 1].matchAll(DURATION)][0]);
    if (Math.abs(shown - expected[i]) > allowed) {
      return `"${found[0]}" differs from "${reason}" by ${Math.abs(shown - expected[i])} min (at most ${allowed} min may have elapsed)`;
    }
  }
  return null;
}
