export const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
export const SUITS = ["h","d","c","s"];

export const RANK_IDX: Record<string, number> =
  Object.fromEntries(RANKS.map((r, i) => [r, i]));
export const SUIT_IDX: Record<string, number> =
  Object.fromEntries(SUITS.map((s, i) => [s, i]));

export const norm = (t: string) =>
  (t && t.length >= 2 ? t[0].toUpperCase() + t[1].toLowerCase() : "");

export const tokenize = (s: string): string[] =>
  (s.match(/([2-9TJQKA][hdcs])/gi) || []).map(norm);

export const sortCardsDesc = (cards: string[]): string[] =>
  cards.slice().sort((a, b) => {
    const ra = RANK_IDX[a[0].toUpperCase()] ?? 999;
    const rb = RANK_IDX[b[0].toUpperCase()] ?? 999;
    if (ra !== rb) return ra - rb;
    const sa = SUIT_IDX[a[1].toLowerCase()] ?? 999;
    const sb = SUIT_IDX[b[1].toLowerCase()] ?? 999;
    return sa - sb;
  });

export const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
};

export const sampleN = (avail: string[], n: number): string[] => {
  const a = avail.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};
