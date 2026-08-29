import { useEffect, useRef, useState } from "react";
import type { GameWithPurchaseUtilization } from "@shelf-judge/shared";
import {
  createCollectionNavigationContext,
  type CollectionNavigationEntry,
  type CreateCollectionNavigationContextInput,
} from "@/lib/collection-navigation-context";

export type CollectionNavigationViewMode = "flat" | "grouped";

export type CollectionNavigationFingerprintInput =
  Readonly<CreateCollectionNavigationContextInput> & {
    readonly viewMode: CollectionNavigationViewMode;
  };

export interface CollectionNavigationProducerSuccess {
  readonly fingerprint: string;
  readonly key: string;
}

export interface CollectionNavigationProducerState {
  readonly currentFingerprint: string;
  readonly attemptedFingerprint: string | null;
  readonly successful: CollectionNavigationProducerSuccess | null;
}

export type CollectionNavigationProducerEvent =
  | { readonly type: "projection-changed"; readonly fingerprint: string }
  | { readonly type: "persistence-attempted"; readonly fingerprint: string }
  | { readonly type: "persistence-succeeded"; readonly fingerprint: string; readonly key: string }
  | { readonly type: "persistence-failed"; readonly fingerprint: string };

type NavigationEntrySource = {
  readonly game: Pick<GameWithPurchaseUtilization["game"], "id" | "name">;
};

export type CollectionNavigationContextCreator = (
  input: CreateCollectionNavigationContextInput,
) => Promise<string | null>;

export type CollectionNavigationProducerDispatch = (
  event: CollectionNavigationProducerEvent,
) => CollectionNavigationProducerState;

export interface CollectionNavigationProducerLifecycleInput {
  readonly hydrated: boolean;
  readonly fingerprintInput: CollectionNavigationFingerprintInput;
  readonly dispatch: CollectionNavigationProducerDispatch;
  readonly createContext: CollectionNavigationContextCreator;
}

export interface UseCollectionNavigationProducerInput {
  readonly hydrated: boolean;
  readonly fingerprintInput: CollectionNavigationFingerprintInput;
  readonly createContext?: CollectionNavigationContextCreator;
}

export function createCollectionNavigationEntries(
  withValue: readonly NavigationEntrySource[],
  withoutValue: readonly NavigationEntrySource[],
): readonly CollectionNavigationEntry[] {
  return [...withValue, ...withoutValue].map(({ game }) => ({ id: game.id, name: game.name }));
}

export function collectionNavigationFingerprint(
  input: CollectionNavigationFingerprintInput,
): string {
  return JSON.stringify({
    entries: input.entries.map((entry, order) => [order, entry.id, entry.name]),
    sort: [input.projection.sort.field, input.projection.sort.direction],
    filters: [
      input.projection.filters.search,
      input.projection.filters.ratedStatus,
      input.projection.filters.playedStatus,
      input.projection.filters.playerCount,
    ],
    scope: [input.collectionScope.showPreviouslyOwned, input.collectionScope.missingDimensionsOnly],
    predictions: [input.projection.predictionsOn, input.projection.effectivePredictionsOn],
    nichesOn: input.projection.nichesOn,
    viewMode: input.viewMode,
  });
}

export function createCollectionNavigationProducerState(
  currentFingerprint: string,
): CollectionNavigationProducerState {
  return {
    currentFingerprint,
    attemptedFingerprint: null,
    successful: null,
  };
}

export function transitionCollectionNavigationProducer(
  state: CollectionNavigationProducerState,
  event: CollectionNavigationProducerEvent,
): CollectionNavigationProducerState {
  switch (event.type) {
    case "projection-changed":
      return event.fingerprint === state.currentFingerprint
        ? state
        : { ...state, currentFingerprint: event.fingerprint };
    case "persistence-attempted":
      if (
        event.fingerprint !== state.currentFingerprint ||
        event.fingerprint === state.attemptedFingerprint
      ) {
        return state;
      }
      return { ...state, attemptedFingerprint: event.fingerprint };
    case "persistence-succeeded":
      if (
        event.fingerprint !== state.currentFingerprint ||
        event.fingerprint !== state.attemptedFingerprint
      ) {
        return state;
      }
      return { ...state, successful: { fingerprint: event.fingerprint, key: event.key } };
    case "persistence-failed":
      return state;
  }
}

export function selectCollectionNavigationKey(
  state: CollectionNavigationProducerState,
  input: CollectionNavigationFingerprintInput,
  hydrated: boolean,
): string | null {
  if (!hydrated || input.viewMode !== "flat" || input.entries.length === 0) return null;

  const fingerprint = collectionNavigationFingerprint(input);
  if (state.currentFingerprint !== fingerprint || state.successful?.fingerprint !== fingerprint) {
    return null;
  }
  return state.successful.key;
}

export function runCollectionNavigationProducerLifecycle({
  hydrated,
  fingerprintInput,
  dispatch,
  createContext,
}: CollectionNavigationProducerLifecycleInput): Promise<void> | null {
  const fingerprint = collectionNavigationFingerprint(fingerprintInput);
  const projected = dispatch({ type: "projection-changed", fingerprint });
  if (
    !hydrated ||
    fingerprintInput.viewMode !== "flat" ||
    fingerprintInput.entries.length === 0 ||
    projected.attemptedFingerprint === fingerprint
  ) {
    return null;
  }

  dispatch({ type: "persistence-attempted", fingerprint });
  const contextInput: CreateCollectionNavigationContextInput = {
    entries: fingerprintInput.entries,
    collectionScope: fingerprintInput.collectionScope,
    projection: fingerprintInput.projection,
  };

  return Promise.resolve()
    .then(() => createContext(contextInput))
    .then(
      (key) => {
        dispatch(
          key === null
            ? { type: "persistence-failed", fingerprint }
            : { type: "persistence-succeeded", fingerprint, key },
        );
      },
      () => {
        dispatch({ type: "persistence-failed", fingerprint });
      },
    );
}

export function useCollectionNavigationProducer({
  hydrated,
  fingerprintInput,
  createContext = createCollectionNavigationContext,
}: UseCollectionNavigationProducerInput): string | null {
  const fingerprint = collectionNavigationFingerprint(fingerprintInput);
  const [renderedState, setRenderedState] = useState(() =>
    createCollectionNavigationProducerState(fingerprint),
  );
  const stateRef = useRef(renderedState);

  useEffect(() => {
    const dispatch = (
      event: CollectionNavigationProducerEvent,
    ): CollectionNavigationProducerState => {
      const next = transitionCollectionNavigationProducer(stateRef.current, event);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setRenderedState(next);
      }
      return next;
    };

    void runCollectionNavigationProducerLifecycle({
      hydrated,
      fingerprintInput,
      dispatch,
      createContext,
    });
  }, [createContext, fingerprint, fingerprintInput, hydrated]);

  return selectCollectionNavigationKey(renderedState, fingerprintInput, hydrated);
}
