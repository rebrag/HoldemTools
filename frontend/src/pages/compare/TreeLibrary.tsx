// src/pages/compare/TreeLibrary.tsx
//
// The tree picker that sits beside the /compare tree builder: PioViewer's
// saved-tree pane, in this app's vocabulary.
//
// Two sources, in the order a user reaches for them:
//   - Trees: their own saved configurations, in folders they nest however they
//     like. Saving needs an account.
//   - Built-in: the engine's benchmark spots (enginePresets.ts), read-only.
//     These are what a signed-out user gets, so the panel is never empty, and
//     unlike the dropdown they replace, each one's note is actually visible.
//
// Deliberately shaped like components/RangeSelector's library half - same
// folder rows, same expand toggle, same target/delete affordances - because the
// two panels sit a few inches apart in the same drawer and a user should not
// have to learn them separately.
//
// It lives under pages/ rather than components/ because it needs BuilderState
// and ENGINE_PRESETS, and nothing in src/components may import from src/pages.
import { useMemo, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import { buttonCls, inputCls } from "@/components/TreeBuilding";
import { parseBoardCards } from "@/components/treeBuildingView";
import {
  createFolder,
  createTree,
  deleteFolder,
  deleteTree,
  updateTree,
  type SavedTree,
  type TreeFolder,
} from "@/lib/savedTreesApi";
import { useSavedTrees } from "@/hooks/useSavedTrees";
import type { BuilderState } from "./builderState";
import { ENGINE_PRESETS, type EnginePreset } from "./enginePresets";
import { applySavedTree, serializeSavedTree } from "./savedTreePayload";

type Tab = "saved" | "builtin";

/** A folder plus everything under it, assembled from the flat parentId list. */
interface FolderNode {
  folder: TreeFolder;
  children: FolderNode[];
  trees: SavedTree[];
}

const buildFolderTree = (folders: TreeFolder[], trees: SavedTree[]) => {
  const nodes = new Map<string, FolderNode>(
    folders.map((folder) => [folder.id, { folder, children: [], trees: [] }])
  );
  const roots: FolderNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.folder.parentId ? nodes.get(node.folder.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rootTrees: SavedTree[] = [];
  for (const tree of trees) {
    const owner = tree.folderId ? nodes.get(tree.folderId) : undefined;
    if (owner) owner.trees.push(tree);
    else rootTrees.push(tree);
  }
  return { roots, rootTrees };
};

/**
 * The board and pot of a stored tree, for the row's subtitle.
 *
 * Read straight off the PioViewer text inside the envelope rather than by
 * running the full parser: a row only needs a label, and a tree that fails to
 * parse should still be listed - and still be deletable - rather than vanishing.
 */
const summarize = (config: string): { board: string[]; pot: string | null } => {
  let pio = "";
  try {
    pio = (JSON.parse(config) as { pio?: string }).pio ?? "";
  } catch {
    return { board: [], pot: null };
  }
  const board = /#Board#(.*)/.exec(pio)?.[1] ?? "";
  const pot = /#Pot#(.*)/.exec(pio)?.[1]?.trim() ?? null;
  return { board: parseBoardCards(board), pot: pot || null };
};

interface TreeLibraryProps {
  /** The builder state a Save captures, and the base a load is merged over. */
  value: BuilderState;
  onChange: (next: BuilderState) => void;
  disabled?: boolean;
}

const TreeLibrary = ({ value, onChange, disabled }: TreeLibraryProps) => {
  const { folders, trees, loading, signedIn, error, refresh, mutate, pruneSubtree } =
    useSavedTrees();

  const [tab, setTab] = useState<Tab>("saved");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [saveName, setSaveName] = useState("");
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const library = useMemo(() => buildFolderTree(folders, trees), [folders, trees]);

  const flash = (kind: "ok" | "error", text: string) => setNotice({ kind, text });

  /** Every mutation here is a network round trip that can fail; this keeps the
   *  call sites from each re-implementing the busy/notice dance. */
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Could not " + what + ".");
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

  const loadSaved = (saved: SavedTree) => {
    try {
      onChange(applySavedTree(value, saved.config));
      flash("ok", `Loaded "${saved.name}".`);
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Could not read that tree.");
    }
  };

  const loadPreset = (preset: EnginePreset) => {
    // Merged over the current state, never replacing it: a preset pins the spot
    // and the sizings, and deliberately leaves the solve settings alone.
    onChange({ ...value, ...preset.patch });
    flash("ok", `Loaded "${preset.label}".`);
  };

  const onSave = () =>
    run("save the tree", async () => {
      const name = saveName.trim();
      if (!name) {
        flash("error", "Give the tree a name first.");
        return;
      }
      const config = serializeSavedTree(value);
      // Overwrite by name within the same folder rather than piling up
      // near-duplicates: re-saving a spot after a tweak is the common case.
      const existing = trees.find(
        (t) => t.folderId === saveFolderId && t.name.toLowerCase() === name.toLowerCase()
      );
      const saved = existing
        ? await updateTree(existing.id, { name, folderId: saveFolderId, config })
        : await createTree({ name, folderId: saveFolderId, config });
      mutate({ trees: [saved] });
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

  const onDeleteFolder = (folder: TreeFolder) =>
    run("delete the folder", async () => {
      await deleteFolder(folder.id);
      pruneSubtree(folder.id);
      if (saveFolderId === folder.id) setSaveFolderId(null);
      flash("ok", `Deleted "${folder.name}". Trees inside it moved to the top level.`);
    });

  const onDeleteTree = (saved: SavedTree) =>
    run("delete the tree", async () => {
      await deleteTree(saved.id);
      mutate({ removeTreeIds: [saved.id] });
      flash("ok", `Deleted "${saved.name}".`);
    });

  /* ---------- rows ---------- */

  /** Board cards at row scale. Three at most: the row is narrow, and the point
   *  is to recognise a spot, not to read the runout. */
  const boardStrip = (cards: string[]) =>
    cards.length === 0 ? null : (
      <span className="flex shrink-0 items-center gap-0.5">
        {cards.slice(0, 3).map((code) => (
          <PlayingCard key={code} code={code} width={13} />
        ))}
        {cards.length > 3 && (
          <span className="text-[9px] tabular-nums text-slate-500">+{cards.length - 3}</span>
        )}
      </span>
    );

  const treeRow = (saved: SavedTree) => {
    const { board, pot } = summarize(saved.config);
    return (
      <div
        key={saved.id}
        className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-800/70"
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => loadSaved(saved)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:opacity-50"
          title={`Load "${saved.name}"`}
        >
          <span className="w-full truncate text-xs text-slate-200">{saved.name}</span>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            {boardStrip(board)}
            {pot && <span className="tabular-nums">pot {pot}</span>}
          </span>
        </button>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void onDeleteTree(saved)}
          className="shrink-0 rounded px-1 text-[11px] text-slate-500 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
          title={`Delete "${saved.name}"`}
          aria-label={`Delete ${saved.name}`}
        >
          ×
        </button>
      </div>
    );
  };

  const folderNode = (node: FolderNode, depth: number) => {
    const open = expanded.has(node.folder.id);
    const count = node.trees.length + node.children.length;
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
            {node.trees.map(treeRow)}
            {count === 0 && (
              <p className="px-1 py-0.5 text-[10px] italic text-slate-600">empty</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const presetRow = (preset: EnginePreset) => (
    <button
      key={preset.id}
      type="button"
      disabled={disabled}
      onClick={() => loadPreset(preset)}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-slate-800/70 disabled:opacity-50"
    >
      <span className="flex w-full items-center gap-1.5">
        {boardStrip(parseBoardCards(String(preset.patch.board ?? "")))}
        <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{preset.label}</span>
      </span>
      <span className="text-[10px] leading-snug text-slate-500">{preset.note}</span>
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

  const targetLabel = folders.find((f) => f.id === saveFolderId)?.name ?? "the top level";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        {tabButton("saved", "Trees")}
        {tabButton("builtin", "Built-in")}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
        {tab === "saved" && (
          <>
            {!signedIn ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">
                Sign in to save your own trees. The built-in benchmark spots work either
                way.
              </p>
            ) : loading ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">Loading your trees…</p>
            ) : error ? (
              <div className="px-1 py-2">
                {/* Bounded: a server fault arrives as its raw message, and an
                    unbounded stack trace would push everything else out of a
                    panel this narrow. The full text stays in the title. */}
                <p
                  className="max-h-24 overflow-y-auto break-words text-[11px] text-red-400"
                  title={error}
                >
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mt-1 text-[11px] text-emerald-400 underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : library.roots.length === 0 && library.rootTrees.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-slate-500">
                Nothing saved yet. Build a tree on the left, name it, and hit Save.
              </p>
            ) : (
              <>
                {library.roots.map((node) => folderNode(node, 0))}
                {library.rootTrees.map(treeRow)}
              </>
            )}
          </>
        )}

        {tab === "builtin" && (
          <>
            {ENGINE_PRESETS.map(presetRow)}
            <p className="px-1 pt-1 text-[10px] italic leading-snug text-slate-600">
              The exact trees behind engine/docs/roadmap.md. A run started from one of
              these is comparable to a recorded result - edit it and it stops being.
            </p>
          </>
        )}
      </div>

      {/* Save row - always visible, so the path from "built" to "saved" is one
          field and one button wherever you are in the picker. */}
      {signedIn && (
        <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-2">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Name this tree"
              aria-label="Name this tree"
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
  );
};

export default TreeLibrary;
