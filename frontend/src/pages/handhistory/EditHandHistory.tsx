// src/pages/handhistory/EditHandHistory.tsx
// Route wrapper for editing a saved hand (/hand-history/edit/:key): resolves
// the hand - device-local store for signed-out localIds, an authed by-id fetch
// for server hands (the fetch, not the text cache, because editing needs the
// authoritative sessionId to preserve the bankroll link on save) - then mounts
// the recorder in edit mode, opened at the resolved end of the hand.
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { User } from "firebase/auth";
import { useAppNavigate } from "@/components/layout/RouteProgress";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import { authedFetch } from "@/lib/api";
import CreateHandHistory, { type EditTarget } from "./create/CreateHandHistory";
import { parseReplay } from "./create/replay";
import type { HandHistory } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; target: EditTarget };

const NO_PAYLOAD_MSG =
  "This hand has no replay data (imported or legacy text-only), so it can't be edited.";

const EditHandHistory: React.FC<{ user: User | null }> = ({ user }) => {
  const { key } = useParams<{ key: string }>();
  const navigate = useAppNavigate();
  const { localHands } = useLocalHandHistories();
  // Current-value read only: re-running the resolver on every store identity
  // change would refetch mid-edit (see HandReplay's identical pattern).
  const localHandsRef = useRef(localHands);
  localHandsRef.current = localHands;

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const showSpinner = useDelayedLoading(load.status === "loading");

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });

    if (!key) {
      setLoad({ status: "error", message: "That hand doesn't exist." });
      return;
    }

    // Device-local (signed-out) hands never touch the network.
    const local = localHandsRef.current.find((h) => h.localId === key);
    if (local) {
      setLoad(
        parseReplay(local.rawText)
          ? {
              status: "ready",
              target: {
                key,
                serverId: null,
                sessionId: null,
                rawText: local.rawText,
              },
            }
          : { status: "error", message: NO_PAYLOAD_MSG }
      );
      return;
    }

    if (!user) {
      setLoad({ status: "error", message: "Sign in to edit this hand." });
      return;
    }

    void (async () => {
      try {
        const res = await authedFetch(`/api/handhistory/${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error();
        const hand = (await res.json()) as HandHistory;
        if (cancelled || typeof hand?.rawText !== "string") return;
        setLoad(
          parseReplay(hand.rawText)
            ? {
                status: "ready",
                target: {
                  key,
                  serverId: hand.id,
                  sessionId: hand.sessionId,
                  rawText: hand.rawText,
                },
              }
            : { status: "error", message: NO_PAYLOAD_MSG }
        );
      } catch {
        if (!cancelled)
          setLoad({
            status: "error",
            message: "We couldn't load that hand. It may have been deleted.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, user]);

  if (load.status === "loading") {
    return (
      <div className="flex items-center justify-center py-24">
        {showSpinner && <LoadingIndicator />}
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-slate-200">{load.message}</p>
        <button
          type="button"
          onClick={() => navigate("/hand-history")}
          className="mt-4 text-sm font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          ← Back to hand histories
        </button>
      </div>
    );
  }

  // Keyed by hand so navigating edit-to-edit remounts the recorder's
  // mount-time reconstruction.
  return <CreateHandHistory key={load.target.key} user={user} edit={load.target} />;
};

export default EditHandHistory;
