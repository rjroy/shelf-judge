"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  resolveCollectionNavigationContext,
  type CollectionNavigationContextV1,
  type CollectionNavigationEntry,
} from "@/lib/collection-navigation-context";

export interface DetailCollectionNavigation {
  readonly previous: CollectionNavigationEntry | null;
  readonly next: CollectionNavigationEntry | null;
}

export interface DetailCollectionContextModel {
  readonly collectionHref: string;
  readonly contextKey: string;
  readonly originId: string;
  readonly navigation: DetailCollectionNavigation | null;
}

export interface DetailCollectionRequestIdentity {
  readonly currentId: string;
  readonly contextKey: string | undefined;
  readonly originId: string | undefined;
}

export interface DetailCollectionNavigationLifecycle {
  readonly request: DetailCollectionRequestIdentity;
  readonly generation: number;
  readonly model: DetailCollectionContextModel | null;
}

function sameRequest(
  left: DetailCollectionRequestIdentity,
  right: DetailCollectionRequestIdentity,
): boolean {
  return (
    left.currentId === right.currentId &&
    left.contextKey === right.contextKey &&
    left.originId === right.originId
  );
}

export function createDetailCollectionNavigationLifecycle(
  request: DetailCollectionRequestIdentity,
): DetailCollectionNavigationLifecycle {
  return { request, generation: 0, model: null };
}

export function transitionDetailCollectionNavigationRequest(
  lifecycle: DetailCollectionNavigationLifecycle,
  request: DetailCollectionRequestIdentity,
): DetailCollectionNavigationLifecycle {
  if (sameRequest(lifecycle.request, request)) return lifecycle;
  return {
    request,
    generation: lifecycle.generation + 1,
    model: null,
  };
}

export function completeDetailCollectionNavigationRequest(
  lifecycle: DetailCollectionNavigationLifecycle,
  generation: number,
  model: DetailCollectionContextModel | null,
): DetailCollectionNavigationLifecycle {
  return lifecycle.generation === generation ? { ...lifecycle, model } : lifecycle;
}

function buildGameHref(gameId: string, contextKey: string, originId: string): string {
  const params = new URLSearchParams({
    collectionContext: contextKey,
    collectionOrigin: originId,
  });
  return `/games/${encodeURIComponent(gameId)}?${params.toString()}`;
}

function buildCollectionHref(context: CollectionNavigationContextV1, originId: string): string {
  const params = new URLSearchParams();
  if (context.collectionScope.showPreviouslyOwned) params.set("ownership", "all");
  if (context.collectionScope.missingDimensionsOnly) params.set("dimensions", "missing");
  params.set("collectionContext", context.key);
  params.set("collectionOrigin", originId);
  return `/collection?${params.toString()}#collection-game-${encodeURIComponent(originId)}`;
}

export function buildDetailCollectionContextModel(
  context: CollectionNavigationContextV1,
  currentId: string,
  originId: string,
): DetailCollectionContextModel | null {
  const currentIndexes: number[] = [];
  let originCount = 0;
  context.entries.forEach((entry, index) => {
    if (entry.id === currentId) currentIndexes.push(index);
    if (entry.id === originId) originCount += 1;
  });
  if (currentIndexes.length !== 1 || originCount !== 1) return null;

  const currentIndex = currentIndexes[0];
  if (currentIndex === undefined) return null;
  const navigation =
    context.entries.length < 2
      ? null
      : {
          previous: currentIndex > 0 ? (context.entries[currentIndex - 1] ?? null) : null,
          next:
            currentIndex < context.entries.length - 1
              ? (context.entries[currentIndex + 1] ?? null)
              : null,
        };

  return {
    collectionHref: buildCollectionHref(context, originId),
    contextKey: context.key,
    originId,
    navigation,
  };
}

function NavigationDestination({
  direction,
  entry,
  contextKey,
  originId,
}: {
  direction: "Previous" | "Next";
  entry: CollectionNavigationEntry | null;
  contextKey: string;
  originId: string;
}) {
  const side = direction.toLowerCase();
  if (entry === null) {
    return (
      <span className={`detail-navigation-boundary ${side}`}>
        {direction === "Previous" ? "No previous game" : "No next game"}
      </span>
    );
  }

  return (
    <Link
      className={`detail-navigation-link ${side}`}
      href={buildGameHref(entry.id, contextKey, originId)}
      aria-label={`${direction} game: ${entry.name}`}
    >
      <span className="detail-navigation-label">{direction}</span>
      <span className="detail-navigation-name">{entry.name}</span>
    </Link>
  );
}

export function GameDetailCollectionNavigationView({
  gameName,
  actions,
  model,
}: {
  gameName: string;
  actions: ReactNode;
  model: DetailCollectionContextModel | null;
}) {
  return (
    <>
      <div className="topbar">
        <div className="breadcrumb">
          <Link href={model?.collectionHref ?? "/collection"}>Collection</Link>
          <span>&rsaquo;</span>
          <strong>{gameName}</strong>
        </div>
        {actions}
      </div>
      {model?.navigation && (
        <nav className="detail-collection-navigation" aria-label="Collection game navigation">
          <NavigationDestination
            direction="Previous"
            entry={model.navigation.previous}
            contextKey={model.contextKey}
            originId={model.originId}
          />
          <NavigationDestination
            direction="Next"
            entry={model.navigation.next}
            contextKey={model.contextKey}
            originId={model.originId}
          />
        </nav>
      )}
    </>
  );
}

export function GameDetailCollectionNavigation({
  gameId,
  gameName,
  collectionContext,
  collectionOrigin,
  children,
}: {
  gameId: string;
  gameName: string;
  collectionContext?: string;
  collectionOrigin?: string;
  children: ReactNode;
}) {
  const request: DetailCollectionRequestIdentity = {
    currentId: gameId,
    contextKey: collectionContext,
    originId: collectionOrigin,
  };
  const [lifecycle, setLifecycle] = useState(() =>
    createDetailCollectionNavigationLifecycle(request),
  );
  const currentLifecycle = transitionDetailCollectionNavigationRequest(lifecycle, request);
  const launchedGenerations = useRef(new Set<number>());

  if (currentLifecycle !== lifecycle) setLifecycle(currentLifecycle);

  useEffect(() => {
    if (collectionContext === undefined || collectionOrigin === undefined) return;
    const generation = currentLifecycle.generation;
    if (launchedGenerations.current.has(generation)) return;
    launchedGenerations.current.add(generation);

    void (async () => {
      const context = await resolveCollectionNavigationContext(collectionContext, {
        currentId: gameId,
        originId: collectionOrigin,
      });
      setLifecycle((current) =>
        completeDetailCollectionNavigationRequest(
          current,
          generation,
          context === null
            ? null
            : buildDetailCollectionContextModel(context, gameId, collectionOrigin),
        ),
      );
    })();
  }, [collectionContext, collectionOrigin, currentLifecycle.generation, gameId]);

  return (
    <GameDetailCollectionNavigationView
      gameName={gameName}
      actions={children}
      model={currentLifecycle.model}
    />
  );
}
