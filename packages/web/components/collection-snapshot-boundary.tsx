"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { NormalizeFitnessButton } from "@/components/normalize-fitness-button";
import { CollectionSnapshotStatus } from "@/components/collection-snapshot-status";
import { CollectionTable } from "@/components/collection-table";
import {
  createCollectionSnapshotClient,
  type CollectionSnapshotClient,
} from "@/lib/collection-snapshot-client";
import { projectCollectionSnapshot } from "@/lib/collection-snapshot-projection";
import type { CollectionSnapshot } from "@shelf-judge/shared";

interface CollectionSnapshotBoundaryProps {
  readonly showPreviouslyOwned: boolean;
  readonly missingDimensionsOnly: boolean;
  readonly collectionContext?: string;
  readonly collectionOrigin?: string;
  readonly collectionReturnAttempt: boolean;
}

type BoundaryState =
  | { readonly status: "loading"; readonly snapshot: null }
  | { readonly status: "error"; readonly snapshot: null }
  | { readonly status: "ready" | "degraded"; readonly snapshot: CollectionSnapshot };

export function CollectionSnapshotBoundary(props: CollectionSnapshotBoundaryProps) {
  const pathname = usePathname();
  const [client] = useState<CollectionSnapshotClient>(() => createCollectionSnapshotClient());
  const [state, setState] = useState<BoundaryState>({ status: "loading", snapshot: null });
  const requestInFlight = useRef(false);
  const requestSerial = useRef(0);
  const pendingRevalidation = useRef(false);
  const loadRef = useRef<(keepCurrentWhileLoading: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const alive = useRef(true);

  const load = useCallback(
    async (keepCurrentWhileLoading: boolean, force = false) => {
      if (requestInFlight.current && !force) return;
      requestInFlight.current = true;
      const serial = ++requestSerial.current;
      if (!keepCurrentWhileLoading) setState({ status: "loading", snapshot: null });
      try {
        const result = await client.load();
        if (!alive.current || serial !== requestSerial.current) return;
        setState({
          status: result.snapshot.status === "complete" ? "ready" : "degraded",
          snapshot: result.snapshot,
        });
      } catch {
        if (alive.current && serial === requestSerial.current)
          setState({ status: "error", snapshot: null });
      } finally {
        if (serial === requestSerial.current) {
          requestInFlight.current = false;
          if (
            pendingRevalidation.current &&
            alive.current &&
            document.visibilityState === "visible"
          ) {
            pendingRevalidation.current = false;
            queueMicrotask(() => void loadRef.current(true));
          }
        }
      }
    },
    [client],
  );
  loadRef.current = load;

  const onCommittedMutation = useCallback(async () => {
    client.onCommittedMutation();
    pendingRevalidation.current = false;
    // Keep the mounted table during the request so its local sort/filter/toggle state survives.
    await load(true, true);
  }, [client, load]);

  useEffect(() => {
    if (pathname !== "/collection") return;
    alive.current = true;
    if (props.collectionReturnAttempt) client.onCommittedMutation();
    void load(false);
    let queued = false;
    const queueRevalidation = () => {
      if (document.visibilityState !== "visible" || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (document.visibilityState !== "visible") return;
        if (requestInFlight.current) pendingRevalidation.current = true;
        else {
          pendingRevalidation.current = false;
          void load(true);
        }
      });
    };
    window.addEventListener("focus", queueRevalidation);
    document.addEventListener("visibilitychange", queueRevalidation);
    return () => {
      alive.current = false;
      client.cancel();
      requestSerial.current++;
      requestInFlight.current = false;
      pendingRevalidation.current = false;
      window.removeEventListener("focus", queueRevalidation);
      document.removeEventListener("visibilitychange", queueRevalidation);
    };
  }, [client, load, pathname, props.collectionReturnAttempt]);

  const tableData = state.snapshot ? projectCollectionSnapshot(state.snapshot) : null;

  return (
    <>
      <div className="topbar">
        <h1 id="collection-heading" className="topbar-title" tabIndex={-1}>
          My Collection
        </h1>
        {tableData && tableData.games.length > 0 && (
          <div className="topbar-meta">
            <NormalizeFitnessButton onCommittedMutation={onCommittedMutation} />
            <RefreshAllButton onCommittedMutation={onCommittedMutation} />
          </div>
        )}
      </div>
      <div className="main-scroll">
        {!tableData && (
          <CollectionSnapshotStatus
            state={state.status === "error" ? "error" : "loading"}
            onRetry={() => void load(false, true)}
          />
        )}
        {state.status === "degraded" && state.snapshot && (
          <CollectionSnapshotStatus
            state="degraded"
            unavailableFeatures={state.snapshot.unavailableFeatures.map(({ feature }) => feature)}
            onRetry={() => void load(true, true)}
          />
        )}
        {tableData && (
          <CollectionTable
            {...tableData}
            showPreviouslyOwned={props.showPreviouslyOwned}
            missingDimensionsOnly={props.missingDimensionsOnly}
            collectionContext={props.collectionContext}
            collectionOrigin={props.collectionOrigin}
            collectionReturnAttempt={props.collectionReturnAttempt}
            onCommittedMutation={onCommittedMutation}
          />
        )}
      </div>
    </>
  );
}
