// src/components/RangeSelector.tsx
//
// Pick or paint a starting range, with a library to save it into.
//
// Replaces the two ad-hoc "here is a 13x13 grid" overlays the tree-building
// screens used to carry. The grid is still the centre of it; what is new is
// everything around the grid, because painting the same BTN open by hand
// before every solve was the actual complaint.
//
// Three sources, in the order a user reaches for them:
//   - Saved: their own ranges, in folders they nest however they like.
//   - Built-in: canned charts from lib/solver/defaultRanges, read-only. These
//     are what a signed-out user gets, so the picker is never empty.
//   - Paste: one click. It reads the clipboard and loads whatever range is on
//     it - Pio shorthand ("TT+,ATs+,KQo") or weighted tokens ("AA:1,AKs:0.5").
//     A textarea is kept as a FALLBACK only, revealed when the browser refuses
//     the clipboard read (Firefox has no readText for ordinary pages, and
//     Chrome needs the tab focused) or when what came back does not parse.
//     Without that fallback Paste would simply be unusable in Firefox - the
//     same lesson TreeBuilding's config paste already learned.
//
// The grid and the library sit side by side from `sm` up. Stacked, the panel
// was taller than the drawer hosting it; beside each other, the library is
// visible while painting, which is the point of having one.
//
// Saving needs an account; everything else works signed out.
import { useMemo, useState } from "react";
import RangeEditorGrid, {
  RangeMiniGrid,
  weightedComboCount,
} from "@/components/RangeEditorGrid";
import {
  BUILTIN_RANGE_FOLDERS,
  expandRange,
  type BuiltinRange,
} from "@/lib/solver/defaultRanges";
import { parseRangeInput } from "@/lib/solver/rangeTokens";
import {
  createFolder,
  createRange,
  deleteFolder,
  deleteRange,
  updateRange,
  type RangeFolder,
  type SavedRange,
} from "@/lib/savedRangesApi";
import { useSavedRanges } from "@/hooks/useSavedRanges";

/** Pio token string <-> 169-class weights. Passed in by the host so this
 *  component does not reach into a page module for the codec. */
export interface RangeTokenCodec {
  serialize: (weights: Record<string, number>) => string;
  parse: (text: string) => Record<string, number>;
}

const buttonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 " +
  "bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors " +
  "hover:border-slate-500 hover:bg-slate-700/70 active:bg-slate-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 " +
  "placeholder:text-slate-600 transition-colors " +
  "hover:border-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40";

const TOTAL_COMBOS = 1326;

const pctOf = (weights: Record<string, number>) =>
  (weightedComboCount(weights) / TOTAL_COMBOS) * 100;

type Tab = "saved" | "builtin" | "paste";

/** A folder plus everything under it, assembled from the flat ParentId list. */
interface FolderNode {
  folder: RangeFolder;
  children: FolderNode[];
  ranges: SavedRange[];
}

const buildTree = (folders: RangeFolder[], ranges: SavedRange[]) => {
  const nodes = new Map<string, FolderNode>(
    folders.map((folder) => [folder.id, { folder, children: [], ranges: [] }])
  );
  const roots: FolderNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.folder.parentId ? nodes.get(node.folder.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rootRanges: SavedRange[] = [];
  for (const range of ranges) {
    const owner = range.folderId ? nodes.get(range.folderId) : undefined;
    if (owner) owner.ranges.push(range);
    else rootRanges.push(range);
  }
  return { roots, rootRanges };
};

interface RangeSelectorProps {
  weights: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  codec: RangeTokenCodec;
  disabled?: boolean;
}

const RangeSelector = ({ weights, onChange, codec, disabled }: RangeSelectorProps) => {
  const { folders, ranges, loading, signedIn, error, refresh, mutate, pruneSubtree } =
    useSavedRanges();

  const [tab, setTab] = useState<Tab>("saved");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [saveName, setSaveName] = useState("");
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [pasteText, setPasteText] = useState("");

  const tree = useMemo(() => buildTree(folders, ranges), [folders, ranges]);

  const flash = (kind: "ok" | "error", text: string) => setNotice({ kind, text });

  /** Every mutation here is a network round trip that can fail; this keeps the
   *  three call sites from each re-implementing the busy/notice dance. */
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : `Could not ${what}.`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loadWeights = (next: Record<string, number>, label: string) => {
    onChange(next);
    flash("ok", `Loaded ${label} - ${pctOf(next).toFixed(1)}% of hands.`);
  };

  const onSave = () =>
    run("save the range", async () => {
      const name = saveName.trim();
      if (!name) {
        flash("error", "Give the range a name first.");
        return;
      }
      const serialized = codec.serialize(weights);
      if (!serialized) {
        flash("error", "There is nothing painted to save.");
        return;
      }
      // Overwrite by name within the same folder rather than piling up
      // near-duplicates: re-saving "BTN open" after a tweak is the common case.
      const existing = ranges.find(
        (r) => r.folderId === saveFolderId && r.name.toLowerCase() === name.toLowerCase()
      );
      const saved = existing
        ? await updateRange(existing.id, { name, folderId: saveFolderId, weights: serialized })
        : await createRange({ name, folderId: saveFolderId, weights: serialized });
      mutate({ ranges: [saved] });
      setSaveName("");
      flash("ok", existing ? `Updated "${name}".` : `Saved "${name}".`);
    });

  const onNewFolder = () =>
    run("create the folder", async () => {
      const name = newFolderName.trim();
      if (!name) return;
      const folder = await createFolder(name, saveFolderId);
      mutate({ folders: [folder] });
      setNewFolderName("");
      // Open the parent so the new folder is visible where it landed.
      if (saveFolderId) setExpanded((prev) => new Set(prev).add(saveFolderId));
      flash("ok", `Created "${name}".`);
    });

  const onDeleteFolder = (folder: RangeFolder) =>
    run("delete the folder", async () => {
      await deleteFolder(folder.id);
      pruneSubtree(folder.id);
      if (saveFolderId === folder.id) setSaveFolderId(null);
      flash("ok", `Deleted "${folder.name}". Ranges inside it moved to the top level.`);
    });

  const onDeleteRange = (range: SavedRange) =>
    run("delete the range", async () => {
      await deleteRange(range.id);
      mutate({ removeRangeIds: [range.id] });
      flash("ok", `Deleted "${range.name}".`);
    });

  /** Parse and load, or explain why not. `fallback` is what to show in the
   *  textarea when it fails, so a clipboard read that came back as something
   *  unparseable is visible and editable rather than silently discarded. */
  const loadPasted = (text: string, fallback = text): boolean => {
    const parsed = parseRangeInput(text, expandRange);
    if (Object.keys(parsed).length === 0) {
      setTab("paste");
      setPasteText(fallback);
      flash("error", 'Nothing recognisable in there - try "TT+,ATs+,KQo".');
      return false;
    }
    loadWeights(parsed, "the pasted range");
    setPasteText("");
    return true;
  };

  /** The Paste control: clipboard straight into the grid, no intermediate
   *  step. Falls back to the manual textarea when the browser says no. */
  const onPasteFromClipboard = async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setTab("paste");
      flash("error", "This browser will not hand over the clipboard - paste below.");
      return;
    }
    if (!text.trim()) {
      flash("error", "The clipboard is empty.");
      return;
    }
    loadPasted(text);
  };

  /* ---------- rows ---------- */

  const rangeRow = (range: SavedRange) => (
    <div
      key={range.id}
      className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-800/70"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => loadWeights(codec.parse(range.weights), `"${range.name}"`)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
        title={`Load "${range.name}"`}
      >
        <span className="w-6 shrink-0">
          <RangeMiniGrid weights={codec.parse(range.weights)} />
        </span>
        <span className="truncate text-xs text-slate-200">{range.name}</span>
      </button>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => void onDeleteRange(range)}
        className="shrink-0 rounded px-1 text-[11px] text-slate-500 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
        title={`Delete "${range.name}"`}
        aria-label={`Delete ${range.name}`}
      >
        ×
      </button>
    </div>
  );

  const folderNode = (node: FolderNode, depth: number) => {
    const open = expanded.has(node.folder.id);
    const count = node.ranges.length + node.children.length;
    return (
      <div key={node.folder.id}>
        <div
          className="group flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-800/70"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <button
            type="button"
            onClick={() => toggle(node.folder.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={open}
            title={open ? "Collapse" : "Expand"}
          >
            <span
              aria-hidden="true"
              className={`w-3 shrink-0 text-center text-[9px] text-slate-500 ${
                count === 0 ? "opacity-30" : ""
              }`}
            >
              {open ? "−" : "+"}
            </span>
            <span className="truncate text-xs font-medium text-slate-300">
              {node.folder.name}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{count}</span>
          </button>
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => setSaveFolderId(node.folder.id)}
            className={`shrink-0 rounded px-1 text-[10px] transition-opacity ${
              saveFolderId === node.folder.id
                ? "text-emerald-400"
                : "text-slate-500 opacity-0 hover:text-emerald-400 focus:opacity-100 group-hover:opacity-100"
            }`}
            title="Save into this folder"
            aria-label={`Save into ${node.folder.name}`}
          >
            {saveFolderId === node.folder.id ? "● target" : "target"}
          </button>
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void onDeleteFolder(node.folder)}
            className="shrink-0 rounded px-1 text-[11px] text-slate-500 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
            title={`Delete "${node.folder.name}"`}
            aria-label={`Delete folder ${node.folder.name}`}
          >
            ×
          </button>
        </div>
        {open && (
          <div style={{ paddingLeft: `${depth * 12 + 14}px` }}>
            {node.children.map((child) => folderNode(child, depth + 1))}
            {node.ranges.map(rangeRow)}
            {count === 0 && (
              <p className="px-1 py-0.5 text-[10px] italic text-slate-600">empty</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const builtinRow = (range: BuiltinRange) => (
    <button
      key={range.id}
      type="button"
      disabled={disabled}
      onClick={() => loadWeights(expandRange(range.spec), `"${range.name}"`)}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-slate-800/70 disabled:opacity-50"
      title={range.spec}
    >
      <span className="w-6 shrink-0">
        <RangeMiniGrid weights={expandRange(range.spec)} />
      </span>
      <span className="truncate text-xs text-slate-200">{range.name}</span>
    </button>
  );

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        tab === id
          ? "bg-emerald-600 text-white"
          : "bg-slate-800/70 text-slate-300 hover:bg-slate-700/70"
      }`}
    >
      {label}
    </button>
  );

  const targetLabel =
    folders.find((f) => f.id === saveFolderId)?.name ?? "the top level";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 sm:flex-row">
      {/* The grid stays the centre of this panel: the library is a shortcut to
          a starting point, not a replacement for painting one. Its cells are
          aspect-square, so this column's width is what sets its height - hence
          self-start, which stops it stretching to the library's height. */}
      <div className="min-w-0 sm:flex-1 sm:self-start">
        <RangeEditorGrid weights={weights} onChange={onChange} disabled={disabled} />
      </div>

      {/* The library column. Fixed width so the grid takes the slack, and a
          min-h-0 flex column so only the list scrolls, never the panel. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 sm:w-64 sm:flex-none">
      <div className="flex items-center gap-1">
        {tabButton("saved", "Saved")}
        {tabButton("builtin", "Built-in")}
        {/* Not a tab: this one acts. See onPasteFromClipboard - a click reads
            the clipboard and loads the range, and only a browser that refuses
            the read (or text that will not parse) opens the manual pane. */}
        <button
          type="button"
          onClick={() => void onPasteFromClipboard()}
          disabled={disabled}
          title="Read a range off the clipboard and load it straight into the grid"
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            tab === "paste"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800/70 text-slate-300 hover:bg-slate-700/70"
          }`}
        >
          Paste
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
        {tab === "saved" && (
          <>
            {!signedIn ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">
                Sign in to save ranges to your own library. The built-in charts work
                either way.
              </p>
            ) : loading ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">Loading your library…</p>
            ) : error ? (
              <div className="px-1 py-2">
                <p className="text-[11px] text-red-400">{error}</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mt-1 text-[11px] text-emerald-400 underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : tree.roots.length === 0 && tree.rootRanges.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">
                Nothing saved yet. Paint a range above, name it, and hit Save.
              </p>
            ) : (
              <>
                {tree.roots.map((node) => folderNode(node, 0))}
                {tree.rootRanges.map(rangeRow)}
              </>
            )}
          </>
        )}

        {tab === "builtin" && (
          <>
            {BUILTIN_RANGE_FOLDERS.map((folder) => (
              <div key={folder.id} className="mb-1">
                <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {folder.name}
                </p>
                {folder.ranges.map(builtinRow)}
              </div>
            ))}
            <p className="px-1 pt-1 text-[10px] italic text-slate-600">
              Chart approximations, meant as a starting point - edit before solving.
            </p>
          </>
        )}

        {tab === "paste" && (
          <div className="flex flex-col gap-1.5 p-0.5">
            <p className="text-[10px] leading-snug text-slate-500">
              Paste here when the Paste button cannot reach the clipboard itself.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              autoFocus
              placeholder="TT+,ATs+,KQo   or   AA:1,AKs:0.5"
              aria-label="Range to import"
              className={`${inputCls} font-mono leading-snug`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadPasted(pasteText)}
                disabled={!pasteText.trim() || disabled}
                className={buttonCls}
              >
                Load range
              </button>
              <button type="button" onClick={() => setTab("saved")} className={buttonCls}>
                Cancel
              </button>
              <span className="text-[10px] text-slate-600">
                Pio shorthand or weighted tokens
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Save row - always visible, so the path from "painted" to "saved" is
          one field and one button wherever you are in the picker. */}
      {signedIn && (
        <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-2">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Name this range"
              aria-label="Name this range"
              disabled={busy || disabled}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={busy || disabled || !saveName.trim()}
              className={buttonCls}
            >
              Save
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder"
              aria-label="New folder name"
              disabled={busy || disabled}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => void onNewFolder()}
              disabled={busy || disabled || !newFolderName.trim()}
              className={buttonCls}
            >
              Add
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">
              Saving into <span className="text-slate-300">{targetLabel}</span>
            </span>
            {saveFolderId && (
              <button
                type="button"
                onClick={() => setSaveFolderId(null)}
                className="text-[10px] text-emerald-400 underline underline-offset-2"
              >
                use top level
              </button>
            )}
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`rounded-md px-2 py-1 text-[10px] ${
            notice.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
          }`}
        >
          {notice.text}
        </p>
      )}
      </div>
    </div>
  );
};

export default RangeSelector;
