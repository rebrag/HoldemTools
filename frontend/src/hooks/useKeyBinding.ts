// src/hooks/useKeyBinding.ts
//
// A user-chosen keyboard shortcut: one key with its modifiers, captured
// from a real keypress, stored as data, and fired on a window keydown that
// matches. Two hooks share the file so they agree on what a combo is:
// `useKeyCapture` records the next key the user presses (the "press a
// key..." state of a bind button) and `useKeyBinding` runs an action when
// the stored combo is pressed. A capture in progress mutes every binding,
// so setting a shortcut never also fires one.
//
// A plain key (no Ctrl / Alt / Cmd) does not fire while the user is typing
// in a field - "C" bound to an action must still type a club - but a
// modified combo fires anywhere, which is what lets a shortcut work from
// inside an input.
import { useEffect, useRef } from "react";

export interface KeyCombo {
  /** `KeyboardEvent.key`, single characters upper-cased, " " as "Space". */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "Dead", "Unidentified"]);

const normalizeKey = (k: string): string =>
  k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k;

/** The combo a keydown is, or null for a bare modifier press. */
export const comboFromEvent = (e: KeyboardEvent): KeyCombo | null => {
  if (MODIFIER_KEYS.has(e.key)) return null;
  return {
    key: normalizeKey(e.key),
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
};

export const sameCombo = (a: KeyCombo, b: KeyCombo): boolean =>
  a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;

const KEY_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "Del",
};

/** "Ctrl+Shift+K", "⌫", "Cmd+Space": the combo as a label. */
export const formatCombo = (c: KeyCombo): string =>
  [
    c.ctrl && "Ctrl",
    c.alt && (isMac ? "Opt" : "Alt"),
    c.shift && "Shift",
    c.meta && (isMac ? "Cmd" : "Win"),
    KEY_GLYPHS[c.key] ?? c.key,
  ]
    .filter((s): s is string => typeof s === "string")
    .join("+");

/** Parses a stored combo; throws on anything else so a storage hook falls
 *  back to its default. */
export const parseCombo = (raw: string): KeyCombo | null => {
  const v: unknown = JSON.parse(raw);
  if (v === null) return null;
  if (typeof v !== "object") throw new Error("not a combo");
  const o = v as Record<string, unknown>;
  if (typeof o.key !== "string" || o.key.length === 0) throw new Error("not a combo");
  return {
    key: o.key,
    ctrl: o.ctrl === true,
    alt: o.alt === true,
    shift: o.shift === true,
    meta: o.meta === true,
  };
};

const hasModifier = (c: KeyCombo): boolean => c.ctrl || c.alt || c.meta;

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

/* Captures in progress, page-wide. Bindings stay quiet while one is open,
 * whichever component owns it. */
let captures = 0;

/**
 * While `active`, the next key pressed becomes the combo (`onCombo`), or
 * Escape cancels (`onCancel`). Listens in the capture phase and swallows
 * the event, so nothing else on the page sees the press.
 */
export const useKeyCapture = (
  active: boolean,
  onCombo: (combo: KeyCombo) => void,
  onCancel: () => void
): void => {
  const comboRef = useRef(onCombo);
  const cancelRef = useRef(onCancel);
  comboRef.current = onCombo;
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!active) return;
    captures += 1;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === "Escape") {
        cancelRef.current();
        return;
      }
      const combo = comboFromEvent(e);
      if (combo) comboRef.current(combo);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      captures -= 1;
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [active]);
};

/**
 * Runs `onFire` when `combo` is pressed. Nothing is bound while `combo` is
 * null or `enabled` is false.
 */
export const useKeyBinding = (
  combo: KeyCombo | null,
  onFire: () => void,
  enabled = true
): void => {
  const fireRef = useRef(onFire);
  fireRef.current = onFire;

  useEffect(() => {
    if (!combo || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || captures > 0) return;
      const pressed = comboFromEvent(e);
      if (!pressed || !sameCombo(pressed, combo)) return;
      if (isEditable(e.target) && !hasModifier(combo)) return;
      e.preventDefault();
      fireRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, enabled]);
};
