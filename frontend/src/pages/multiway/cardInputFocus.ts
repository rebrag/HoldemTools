// src/pages/multiway/cardInputFocus.ts
//
// Keyboard travel between the page's card inputs. Every HoleCardsPicker
// input carries `data-card-input`, so "the next input" is simply the next
// one in DOM order - which is the reading order the group view lays them
// out in (row by row, seats in acting order) - and nothing has to keep a
// ref list in step with per-row state. Separate from the picker so the
// component file exports only components (fast refresh).

const CARD_INPUT_SELECTOR = "input[data-card-input]";

const focusAndSelect = (el: HTMLInputElement) => {
  el.focus();
  el.select();
};

/** Move focus from one card input to the next (or previous) on the page,
 *  wrapping at the ends. A page with one input or none leaves focus alone. */
export function focusCardInput(from: HTMLInputElement | null, dir: 1 | -1): void {
  if (!from) return;
  const all = Array.from(document.querySelectorAll<HTMLInputElement>(CARD_INPUT_SELECTOR));
  if (all.length <= 1) return;
  const i = all.indexOf(from);
  if (i < 0) return;
  focusAndSelect(all[(i + dir + all.length) % all.length]);
}

/** Focus the card input rendered with this `inputKey` (see the picker's
 *  prop), e.g. to hand focus back after a keypad drawer closes. */
export function focusCardInputByKey(key: string): void {
  const el = document.querySelector<HTMLInputElement>(
    `input[data-card-input="${CSS.escape(key)}"]`
  );
  if (el) focusAndSelect(el);
}
