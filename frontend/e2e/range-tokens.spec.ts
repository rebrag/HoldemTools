// Pure-function tests for the range codec. No browser, same harness as
// money-units.spec.ts.
//
// This is both the clipboard format and the storage format for the saved-range
// library, so a drift here silently rewrites what a user saved.
import { test, expect } from "@playwright/test";
import {
  fullRangeWeights,
  parseRangeInput,
  parseRangeTokens,
  serializeRangeTokens,
} from "../src/lib/solver/rangeTokens";
import { expandRange } from "../src/lib/solver/defaultRanges";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

const combos = (weights: Record<string, number>): number =>
  Object.entries(weights).reduce((sum, [hand, w]) => {
    const n = hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
    return sum + n * w;
  }, 0);

test("a saved range round-trips through the token string", () => {
  const original = { AA: 1, KK: 0.5, AKs: 0.25, AKo: 0.25, T4s: 1, T4o: 1, "72o": 0.125 };
  expect(parseRangeTokens(serializeRangeTokens(original))).toEqual(original);
});

test("the full range round-trips", () => {
  const full = fullRangeWeights();
  expect(combos(full)).toBe(1326);
  expect(parseRangeTokens(serializeRangeTokens(full))).toEqual(full);
});

test("chart shorthand with runs expands, rather than collapsing to one hand", () => {
  // The bug this function exists to prevent: parseRangeTokens is forgiving
  // enough to read "TT+" as the single class TT, so a try-then-fall-back parser
  // silently truncated every run to its first hand.
  const parsed = parseRangeInput("TT+,ATs+,KQo", expandRange);

  // TT+ is TT,JJ,QQ,KK,AA; ATs+ is ATs,AJs,AQs,AKs; plus KQo.
  expect(Object.keys(parsed).sort()).toEqual(
    ["AA", "AJs", "AKs", "AQs", "ATs", "JJ", "KK", "KQo", "QQ", "TT"].sort()
  );
  expect(combos(parsed)).toBe(5 * 6 + 4 * 4 + 12);
});

test("a descending run expands too", () => {
  const parsed = parseRangeInput("A5s-A2s", expandRange);
  expect(Object.keys(parsed).sort()).toEqual(["A2s", "A3s", "A4s", "A5s"]);
});

test("the two dialects can be mixed in one paste", () => {
  // A run, an exact class, a rankless token and a weighted token together.
  const parsed = parseRangeInput("TT+,KQo,T4,72o:0.5", expandRange);

  expect(parsed.TT).toBe(1);
  expect(parsed.AA).toBe(1);
  expect(parsed.KQo).toBe(1);
  // Rankless "T4" is both suited and offsuit - only parseRangeTokens knows that.
  expect(parsed.T4s).toBe(1);
  expect(parsed.T4o).toBe(1);
  expect(parsed["72o"]).toBe(0.5);
});

test("stored Pio output re-parses without being mistaken for shorthand", () => {
  const original = { AA: 1, KK: 0.5, AKs: 0.25, AKo: 0.25 };
  const stored = serializeRangeTokens(original);
  expect(parseRangeInput(stored, expandRange)).toEqual(original);
});

test("garbage is skipped rather than losing the whole range", () => {
  const parsed = parseRangeInput("AA,ZZ,,KQo,%%%", expandRange);
  expect(parsed.AA).toBe(1);
  expect(parsed.KQo).toBe(1);
  expect(Object.keys(parsed).sort()).toEqual(["AA", "KQo"]);
});

test("an empty or meaningless paste yields nothing", () => {
  expect(parseRangeInput("", expandRange)).toEqual({});
  expect(parseRangeInput("   ", expandRange)).toEqual({});
  expect(parseRangeInput("hello world", expandRange)).toEqual({});
});
