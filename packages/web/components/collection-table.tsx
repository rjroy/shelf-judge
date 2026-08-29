"use client";

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  GameWithPurchaseUtilization,
  Axis,
  TournamentGameStatsDisplay,
  NicheTagFilter,
  ShelfCapacityResult,
} from "@shelf-judge/shared";
import { NicheIgnoreButton, NicheRestoreButton } from "@/components/niche-ignore-button";
import { CapacityIndicator } from "@/components/capacity-indicator";
import { scoreRangeClass } from "@/lib/score-utils";
import { relativeDate } from "@/lib/date-utils";
import {
  type FilterState,
  type SortState,
  buildSortFields,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  getScoreDisplay,
  getScoreSubtitle,
  getSeparatorLabel,
  GROUP_LABELS,
  GROUP_ORDER,
  loadFilters,
  loadSort,
  matchesFilters,
  saveFilters,
  saveSort,
  sortGames,
} from "@/lib/collection-utils";
import {
  resolveCollectionNavigationContext,
  type CollectionNavigationContextV1,
  type CollectionNavigationProjection,
  type CollectionNavigationScope,
} from "@/lib/collection-navigation-context";
import {
  createCollectionNavigationEntries,
  useCollectionNavigationProducer,
  type CollectionNavigationFingerprintInput,
} from "@/lib/collection-navigation-producer";

export const COLLECTION_HEADING_ID = "collection-heading";
const COLLECTION_ROW_ID_PREFIX = "collection-game-";
const COLLECTION_SCROLL_HISTORY_KEY = "shelfJudgeCollectionScrollTop";

export interface CollectionReturnCapabilities {
  readonly scope: CollectionNavigationScope;
  readonly availableSortFields: ReadonlySet<string>;
  readonly predictionSourceAvailable: boolean;
  readonly nicheSourceAvailable: boolean;
  readonly effectivePredictionsOn: boolean;
  readonly collectionEmpty: boolean;
}

export function canRestoreCollectionProjection(
  context: CollectionNavigationContextV1,
  capabilities: CollectionReturnCapabilities,
): boolean {
  if (
    context.collectionScope.showPreviouslyOwned !== capabilities.scope.showPreviouslyOwned ||
    context.collectionScope.missingDimensionsOnly !== capabilities.scope.missingDimensionsOnly
  ) {
    return false;
  }
  if (capabilities.collectionEmpty) return true;
  if (!capabilities.availableSortFields.has(context.projection.sort.field)) return false;
  if (
    (context.projection.predictionsOn || context.projection.effectivePredictionsOn) &&
    !capabilities.predictionSourceAvailable
  ) {
    return false;
  }
  if (context.projection.nichesOn && !capabilities.nicheSourceAvailable) return false;
  return context.projection.effectivePredictionsOn === capabilities.effectivePredictionsOn;
}

export function normalizeCollectionSort(
  sort: SortState,
  availableSortFields: ReadonlySet<string>,
  collectionEmpty: boolean,
): SortState {
  return collectionEmpty || availableSortFields.has(sort.field) ? sort : DEFAULT_SORT;
}

export function effectiveCollectionPredictionsOn(
  predictionsOn: boolean,
  predictionSourceAvailable: boolean,
  predictedCount: number,
  isIntegratedRedundancy: boolean,
): boolean {
  return (
    predictionSourceAvailable && (predictionsOn || (predictedCount > 0 && isIntegratedRedundancy))
  );
}

export function collectionRowId(gameId: string): string {
  return `${COLLECTION_ROW_ID_PREFIX}${encodeURIComponent(gameId)}`;
}

export function buildCollectionGameHref(gameId: string, contextKey: string | null): string {
  const route = `/games/${encodeURIComponent(gameId)}`;
  if (contextKey === null) return route;
  const params = new URLSearchParams({
    collectionContext: contextKey,
    collectionOrigin: gameId,
  });
  return `${route}?${params.toString()}`;
}

export function removeCollectionReturnTransport(url: string): string {
  const parsed = new URL(url, "http://collection.local");
  parsed.searchParams.delete("collectionContext");
  parsed.searchParams.delete("collectionOrigin");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function selectCollectionReturnFocusId(
  originId: string,
  entries: readonly { readonly id: string }[],
): string {
  return entries.some((entry) => entry.id === originId)
    ? collectionRowId(originId)
    : COLLECTION_HEADING_ID;
}

export function persistCollectionPreferences(
  projection: Pick<CollectionNavigationProjection, "sort" | "filters">,
  persistSort: (sort: SortState) => void = saveSort,
  persistFilters: (filters: FilterState) => void = saveFilters,
): void {
  persistSort(projection.sort);
  persistFilters(projection.filters);
}

export interface CollectionScrollActivation {
  readonly button: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  readonly target: string | null;
}

export function shouldCaptureCollectionScroll(activation: CollectionScrollActivation): boolean {
  const target = activation.target?.toLowerCase() ?? "";
  return (
    !activation.defaultPrevented &&
    activation.button === 0 &&
    !activation.altKey &&
    !activation.ctrlKey &&
    !activation.metaKey &&
    !activation.shiftKey &&
    (target === "" || target === "_self")
  );
}

function preserveCollectionScrollPosition(event: ReactMouseEvent<HTMLAnchorElement>): void {
  if (
    !shouldCaptureCollectionScroll({
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      defaultPrevented: event.defaultPrevented,
      target: event.currentTarget.getAttribute("target"),
    })
  ) {
    return;
  }
  const scrollOwner = document.querySelector(".main-scroll");
  if (scrollOwner === null) return;
  const currentState: unknown = window.history.state;
  const nextState =
    typeof currentState === "object" && currentState !== null ? { ...currentState } : {};
  window.history.replaceState(
    { ...nextState, [COLLECTION_SCROLL_HISTORY_KEY]: scrollOwner.scrollTop },
    "",
  );
}

interface CollectionTableProps {
  games: GameWithPurchaseUtilization[];
  predictedGames: GameWithPurchaseUtilization[] | null;
  nicheGames: GameWithPurchaseUtilization[] | null;
  axes: Axis[];
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
  hasTournamentData: boolean;
  totalGames: number;
  ratedCount: number;
  avgFitness: number | null;
  predictedCount: number;
  ignoredTags: NicheTagFilter[];
  isIntegratedRedundancy: boolean;
  previouslyOwnedCount: number;
  showPreviouslyOwned: boolean;
  missingDimensionsOnly: boolean;
  capacity: ShelfCapacityResult | null;
  collectionContext?: string;
  collectionOrigin?: string;
  collectionReturnAttempt: boolean;
}

interface CollectionViewState {
  readonly status: "ready" | "restoring";
  readonly hydrated: boolean;
  readonly sort: SortState;
  readonly filters: FilterState;
  readonly playerCountInput: string;
  readonly predictionsOn: boolean;
  readonly nichesOn: boolean;
  readonly nicheViewMode: boolean;
  readonly returnOrigin: string | null;
  readonly cleanupReturnTransport: boolean;
}

export function CollectionTable({
  games,
  predictedGames,
  nicheGames,
  axes,
  tournamentStats,
  hasTournamentData,
  totalGames,
  ratedCount,
  avgFitness,
  predictedCount,
  ignoredTags,
  isIntegratedRedundancy,
  previouslyOwnedCount,
  showPreviouslyOwned,
  missingDimensionsOnly,
  capacity,
  collectionContext,
  collectionOrigin,
  collectionReturnAttempt,
}: CollectionTableProps) {
  const router = useRouter();
  const [view, setView] = useState<CollectionViewState>(() => ({
    status: collectionReturnAttempt ? "restoring" : "ready",
    hydrated: false,
    sort: DEFAULT_SORT,
    filters: DEFAULT_FILTERS,
    playerCountInput: "",
    predictionsOn: false,
    nichesOn: false,
    nicheViewMode: false,
    returnOrigin: null,
    cleanupReturnTransport: false,
  }));
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { sort, filters, playerCountInput, predictionsOn, nichesOn, nicheViewMode, hydrated } =
    view;
  const setSort = useCallback((next: SetStateAction<SortState>) => {
    setView((current) => ({
      ...current,
      sort: typeof next === "function" ? next(current.sort) : next,
    }));
  }, []);
  const setFilters = useCallback((next: SetStateAction<FilterState>) => {
    setView((current) => ({
      ...current,
      filters: typeof next === "function" ? next(current.filters) : next,
    }));
  }, []);
  const setPlayerCountInput = useCallback((next: SetStateAction<string>) => {
    setView((current) => ({
      ...current,
      playerCountInput: typeof next === "function" ? next(current.playerCountInput) : next,
    }));
  }, []);
  const setPredictionsOn = useCallback((next: SetStateAction<boolean>) => {
    setView((current) => ({
      ...current,
      predictionsOn: typeof next === "function" ? next(current.predictionsOn) : next,
    }));
  }, []);
  const setNichesOn = useCallback((next: SetStateAction<boolean>) => {
    setView((current) => ({
      ...current,
      nichesOn: typeof next === "function" ? next(current.nichesOn) : next,
    }));
  }, []);
  const setNicheViewMode = useCallback((next: SetStateAction<boolean>) => {
    setView((current) => ({
      ...current,
      nicheViewMode: typeof next === "function" ? next(current.nicheViewMode) : next,
    }));
  }, []);

  useEffect(() => {
    if (hydrated) saveSort(sort);
  }, [sort, hydrated]);

  useEffect(() => {
    if (hydrated) saveFilters(filters);
  }, [filters, hydrated]);

  useEffect(() => {
    if (!hydrated || collectionReturnAttempt) return;
    const currentState: unknown = window.history.state;
    if (typeof currentState !== "object" || currentState === null) return;
    const scrollTop = Reflect.get(currentState, COLLECTION_SCROLL_HISTORY_KEY) as unknown;
    if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop) || scrollTop < 0) return;
    const frame = requestAnimationFrame(() => {
      const scrollOwner = document.querySelector(".main-scroll");
      if (scrollOwner === null) return;
      scrollOwner.scrollTop = scrollTop;

      const activeState: unknown = window.history.state;
      if (
        typeof activeState !== "object" ||
        activeState === null ||
        Reflect.get(activeState, COLLECTION_SCROLL_HISTORY_KEY) !== scrollTop
      ) {
        return;
      }
      const nextState = structuredClone(activeState);
      Reflect.deleteProperty(nextState, COLLECTION_SCROLL_HISTORY_KEY);
      window.history.replaceState(nextState, "");
    });
    return () => cancelAnimationFrame(frame);
  }, [collectionReturnAttempt, hydrated]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Use predicted games when toggle is on, otherwise use standard games
  const usePredictions = effectiveCollectionPredictionsOn(
    predictionsOn,
    predictedGames !== null,
    predictedCount,
    isIntegratedRedundancy,
  );
  const baseGames = usePredictions && predictedGames ? predictedGames : games;

  // When niches toggle is on, merge nichePosition data from nicheGames onto active games
  const activeGames = useMemo(() => {
    if (!nichesOn || !nicheGames) return baseGames;
    const nicheMap = new Map(
      nicheGames.flatMap((game) =>
        game.nichePosition ? [[game.game.id, game.nichePosition] as const] : [],
      ),
    );
    return baseGames.map((g) => {
      const np = nicheMap.get(g.game.id);
      return np ? { ...g, nichePosition: np } : g;
    });
  }, [baseGames, nichesOn, nicheGames]);

  const hasBggData = activeGames.some((g) => g.game.bggData !== null);
  const sortFields = useMemo(
    () => buildSortFields(axes, hasTournamentData, hasBggData),
    [axes, hasTournamentData, hasBggData],
  );
  const activeDef = sortFields.find((f) => f.id === sort.field) ?? sortFields[0];

  useEffect(() => {
    let cancelled = false;

    async function hydrateCollection(): Promise<void> {
      if (
        collectionReturnAttempt &&
        collectionContext !== undefined &&
        collectionOrigin !== undefined
      ) {
        const context = await resolveCollectionNavigationContext(collectionContext, {
          originId: collectionOrigin,
        });
        if (cancelled) return;
        if (context !== null) {
          const effectivePredictions = effectiveCollectionPredictionsOn(
            context.projection.predictionsOn,
            predictedGames !== null,
            predictedCount,
            isIntegratedRedundancy,
          );
          const restoredSource =
            effectivePredictions && predictedGames !== null ? predictedGames : games;
          const restoredSortFields = new Set(
            buildSortFields(
              axes,
              hasTournamentData,
              restoredSource.some((game) => game.game.bggData !== null),
            ).map((field) => field.id),
          );
          if (
            canRestoreCollectionProjection(context, {
              scope: { showPreviouslyOwned, missingDimensionsOnly },
              availableSortFields: restoredSortFields,
              predictionSourceAvailable: predictedGames !== null,
              nicheSourceAvailable: nicheGames !== null,
              effectivePredictionsOn: effectivePredictions,
              collectionEmpty: games.length === 0,
            })
          ) {
            persistCollectionPreferences(context.projection);
            setView({
              status: "ready",
              hydrated: true,
              sort: context.projection.sort,
              filters: context.projection.filters,
              playerCountInput:
                context.projection.filters.playerCount === null
                  ? ""
                  : String(context.projection.filters.playerCount),
              predictionsOn: context.projection.predictionsOn,
              nichesOn: context.projection.nichesOn,
              nicheViewMode: false,
              returnOrigin: collectionOrigin,
              cleanupReturnTransport: true,
            });
            return;
          }
        }
      }

      const loadedFilters = loadFilters();
      const ordinaryPredictions = effectiveCollectionPredictionsOn(
        false,
        predictedGames !== null,
        predictedCount,
        isIntegratedRedundancy,
      );
      const ordinarySource =
        ordinaryPredictions && predictedGames !== null ? predictedGames : games;
      const ordinarySortFields = new Set(
        buildSortFields(
          axes,
          hasTournamentData,
          ordinarySource.some((game) => game.game.bggData !== null),
        ).map((field) => field.id),
      );
      const loadedSort = normalizeCollectionSort(
        loadSort(),
        ordinarySortFields,
        games.length === 0,
      );
      if (games.length > 0) saveSort(loadedSort);
      setView({
        status: "ready",
        hydrated: true,
        sort: loadedSort,
        filters: loadedFilters,
        playerCountInput:
          loadedFilters.playerCount === null ? "" : String(loadedFilters.playerCount),
        predictionsOn: false,
        nichesOn: false,
        nicheViewMode: false,
        returnOrigin: null,
        cleanupReturnTransport: collectionReturnAttempt,
      });
    }

    void hydrateCollection();
    return () => {
      cancelled = true;
    };
  }, [
    axes,
    collectionContext,
    collectionOrigin,
    collectionReturnAttempt,
    games,
    hasTournamentData,
    isIntegratedRedundancy,
    missingDimensionsOnly,
    nicheGames,
    predictedCount,
    predictedGames,
    showPreviouslyOwned,
  ]);

  const handleSortSelect = useCallback(
    (fieldId: string) => {
      if (fieldId === sort.field) {
        setSort({ field: fieldId, direction: sort.direction === "asc" ? "desc" : "asc" });
      } else {
        const def = sortFields.find((f) => f.id === fieldId);
        setSort({ field: fieldId, direction: def?.defaultDirection ?? "desc" });
      }
      setMenuOpen(false);
    },
    [sort, sortFields],
  );

  const toggleDirection = useCallback(() => {
    setSort((prev) => ({
      ...prev,
      direction: prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const handleScoreHeaderClick = useCallback(() => {
    toggleDirection();
  }, [toggleDirection]);

  const handleGameHeaderClick = useCallback(() => {
    if (sort.field === "name") {
      setSort((prev) => ({ ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }));
    } else {
      setSort({ field: "name", direction: "asc" });
    }
  }, [sort.field]);

  const handleLastRatedHeaderClick = useCallback(() => {
    if (sort.field === "updatedAt") {
      setSort((prev) => ({ ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }));
    } else {
      setSort({ field: "updatedAt", direction: "desc" });
    }
  }, [sort.field]);

  // Filter handlers
  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPlayerCountInput("");
  }, []);

  const handlePlayerCountChange = useCallback(
    (value: string) => {
      setPlayerCountInput(value);
      const num = parseInt(value, 10);
      updateFilter("playerCount", isNaN(num) || num < 1 ? null : num);
    },
    [updateFilter],
  );

  // Apply filters then sort
  const first_filter = useMemo(
    () => activeGames.filter((g) => matchesFilters(g, filters)),
    [activeGames, filters],
  );
  const after_ownership = useMemo(
    () =>
      showPreviouslyOwned
        ? first_filter
        : first_filter.filter((g) => g.game.ownership !== "previously-owned"),
    [first_filter, showPreviouslyOwned],
  );
  const filtered = useMemo(
    () =>
      missingDimensionsOnly
        ? after_ownership.filter((g) => g.game.boxDimensions === null)
        : after_ownership,
    [after_ownership, missingDimensionsOnly],
  );
  const { withValue, withoutValue } = useMemo(
    () => sortGames(filtered, sort.field, sort.direction, tournamentStats, axes),
    [filtered, sort.field, sort.direction, tournamentStats, axes],
  );
  const navigationEntries = useMemo(
    () => createCollectionNavigationEntries(withValue, withoutValue),
    [withValue, withoutValue],
  );
  const navigationFingerprintInput = useMemo<CollectionNavigationFingerprintInput>(
    () => ({
      entries: navigationEntries,
      collectionScope: { showPreviouslyOwned, missingDimensionsOnly },
      projection: {
        sort,
        filters,
        predictionsOn,
        effectivePredictionsOn: usePredictions,
        nichesOn,
      },
      viewMode: nicheViewMode && nichesOn ? "grouped" : "flat",
    }),
    [
      filters,
      missingDimensionsOnly,
      navigationEntries,
      nicheViewMode,
      nichesOn,
      predictionsOn,
      showPreviouslyOwned,
      sort,
      usePredictions,
    ],
  );
  const navigationContextKey = useCollectionNavigationProducer({
    hydrated: hydrated && view.status === "ready",
    fingerprintInput: navigationFingerprintInput,
  });

  useEffect(() => {
    if (!hydrated || !view.cleanupReturnTransport) return;

    if (view.returnOrigin !== null) {
      document
        .getElementById(selectCollectionReturnFocusId(view.returnOrigin, navigationEntries))
        ?.focus();
    }
    window.history.replaceState(
      window.history.state,
      "",
      removeCollectionReturnTransport(window.location.href),
    );
    setView((current) => ({
      ...current,
      returnOrigin: null,
      cleanupReturnTransport: false,
    }));
  }, [hydrated, navigationEntries, view.cleanupReturnTransport, view.returnOrigin]);
  const axisMap = useMemo(() => new Map(axes.map((a) => [a.id, a])), [axes]);
  const isAxisSort = sort.field.startsWith("axis:");
  const separatorLabel =
    withoutValue.length > 0 ? getSeparatorLabel(sort.field, withoutValue.length, axes) : null;
  const scoreSubtitle = getScoreSubtitle(sort.field, axes);
  const dirArrow = sort.direction === "asc" ? "\u2191" : "\u2193";
  const scoreOwnsSort = sort.field !== "name" && sort.field !== "updatedAt";

  // URL-driven filters (ownership and dimensions) navigate to trigger server re-fetch.
  // Preserve whichever filter isn't being toggled so they can coexist.
  const buildCollectionUrl = useCallback((nextOwnership: boolean, nextMissing: boolean) => {
    const parts: string[] = [];
    if (nextOwnership) parts.push("ownership=all");
    if (nextMissing) parts.push("dimensions=missing");
    return parts.length > 0 ? `/collection?${parts.join("&")}` : "/collection";
  }, []);

  const toggleOwnership = useCallback(() => {
    router.push(buildCollectionUrl(!showPreviouslyOwned, missingDimensionsOnly));
  }, [showPreviouslyOwned, missingDimensionsOnly, router, buildCollectionUrl]);

  const clearMissingDimensions = useCallback(() => {
    router.push(buildCollectionUrl(showPreviouslyOwned, false));
  }, [showPreviouslyOwned, router, buildCollectionUrl]);

  // Filter chip state
  const hasSearch = filters.search !== "";
  const hasRatedFilter = filters.ratedStatus !== "all";
  const hasPlayedFilter = filters.playedStatus !== "all";
  const hasPlayerCount = filters.playerCount !== null;
  const activeFilterCount =
    (hasRatedFilter ? 1 : 0) +
    (hasPlayedFilter ? 1 : 0) +
    (hasPlayerCount ? 1 : 0) +
    (showPreviouslyOwned ? 1 : 0) +
    (missingDimensionsOnly ? 1 : 0);
  const hasAnyFilter =
    hasSearch ||
    hasRatedFilter ||
    hasPlayedFilter ||
    hasPlayerCount ||
    showPreviouslyOwned ||
    missingDimensionsOnly;
  const hiddenCount =
    (usePredictions && predictedGames ? predictedGames.length : totalGames) - filtered.length;

  // Build niche groups for "Group by Niche" view (REQ-NICHE-24, REQ-NICHE-25)
  const nicheGroups = useMemo(() => {
    if (!nicheViewMode || !nichesOn) return [];
    const groupMap = new Map<
      string,
      { type: string; name: string; games: GameWithPurchaseUtilization[] }
    >();

    for (const gws of filtered) {
      const niches = gws.nichePosition?.niches;
      if (!niches) continue;
      for (const niche of niches) {
        const key = `${niche.type}:${niche.name}`;
        let group = groupMap.get(key);
        if (!group) {
          group = { type: niche.type, name: niche.name, games: [] };
          groupMap.set(key, group);
        }
        group.games.push(gws);
      }
    }

    // Discard groups with <2 filtered members
    return Array.from(groupMap.values())
      .filter((g) => g.games.length >= 2)
      .sort((a, b) => b.games.length - a.games.length || a.name.localeCompare(b.name))
      .map((group) => ({
        ...group,
        games: group.games.sort((a, b) => {
          // Sort by niche rank within this niche
          const aNiche = a.nichePosition?.niches.find(
            (n) => n.type === group.type && n.name === group.name,
          );
          const bNiche = b.nichePosition?.niches.find(
            (n) => n.type === group.type && n.name === group.name,
          );
          return (aNiche?.rank ?? 999) - (bNiche?.rank ?? 999);
        }),
      }));
  }, [nicheViewMode, nichesOn, filtered]);

  // Group fields for the dropdown menu
  const groupedFields = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    fields: sortFields.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);

  if (view.status === "restoring") {
    return (
      <div className="collection-restoring" role="status" aria-live="polite">
        Restoring collection...
      </div>
    );
  }

  if (!hydrated && games.length === 0) {
    return (
      <div className="collection-restoring" role="status" aria-live="polite">
        Loading collection...
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="empty-state">
        <h2>No games yet</h2>
        <p>Add games to your collection to start rating and tracking fitness scores.</p>
        <div className="empty-state-actions">
          <Link href="/import" className="btn btn-secondary">
            Import BGG Collection
          </Link>
          <Link href="/search" className="btn btn-primary">
            Add Game
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Filter bar (REQ-CFS-15, 16, 20) */}
      <div className="filter-bar">
        <div className="filter-row-1">
          <div className="search-input-wrap">
            <span className="search-icon">{"\uD83D\uDD0D"}</span>
            <input
              type="text"
              className={`search-input${hasSearch ? " has-value" : ""}`}
              placeholder="Search games by name..."
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </div>

          {/* Sort control */}
          <div className="sort-control" ref={menuRef}>
            <span className="sort-label-prefix">Sort by</span>
            <button className="sort-select" onClick={() => setMenuOpen((v) => !v)}>
              <span className="sort-select-label">{activeDef.label}</span>
              <span className="chevron">{menuOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            <button
              className="sort-dir-btn"
              onClick={toggleDirection}
              title="Toggle sort direction"
            >
              {dirArrow}
            </button>

            {menuOpen && (
              <>
                <div className="sort-overlay-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="sort-menu">
                  <div className="sort-menu-header">
                    <span className="sort-menu-title">Sort by</span>
                    <button className="sort-menu-close" onClick={() => setMenuOpen(false)}>
                      {"\u2715"}
                    </button>
                  </div>
                  <div className="sort-menu-scroll">
                    {groupedFields.map(({ group, label, fields }) => (
                      <div className="sort-menu-group" key={group}>
                        <div className="sort-menu-group-label">{label}</div>
                        {fields.map((f) => {
                          const isAxis = f.group === "axes";
                          const isActive = f.id === sort.field;
                          const itemClass = isAxis
                            ? `sort-menu-axis-item${isActive ? " active" : ""}`
                            : `sort-menu-item${isActive ? " active" : ""}`;
                          return (
                            <button
                              key={f.id}
                              className={itemClass}
                              onClick={() => handleSortSelect(f.id)}
                            >
                              <span className="check">{isActive ? "\u2713" : ""}</span>
                              <span className="item-label">{f.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            className={`filter-toggle-btn${activeFilterCount > 0 ? " has-filters" : ""}`}
            onClick={() => setFilterPanelOpen((v) => !v)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="filter-count-badge">{activeFilterCount}</span>
            )}
          </button>
        </div>

        {/* Expandable filter panel (REQ-CFS-16) */}
        {filterPanelOpen && (
          <div className="filter-panel">
            <div className="filter-group">
              <div className="filter-group-label">Status</div>
              <div className="filter-group-controls">
                {(["all", "rated", "unrated"] as const).map((status) => (
                  <button
                    key={status}
                    className={`seg-btn${filters.ratedStatus === status ? " active" : ""}`}
                    onClick={() => updateFilter("ratedStatus", status)}
                  >
                    {status === "all" ? "All" : status === "rated" ? "Rated" : "Unrated"}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-group-label">Played</div>
              <div className="filter-group-controls">
                {(["all", "played", "unplayed"] as const).map((status) => (
                  <button
                    key={status}
                    className={`seg-btn${filters.playedStatus === status ? " active" : ""}`}
                    onClick={() => updateFilter("playedStatus", status)}
                  >
                    {status === "all" ? "All" : status === "played" ? "Played" : "Unplayed"}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-group-label">Player Count</div>
              <div className="filter-group-controls">
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Plays at</span>
                <input
                  type="text"
                  className="range-input"
                  placeholder="#"
                  value={playerCountInput}
                  onChange={(e) => handlePlayerCountChange(e.target.value)}
                />
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>players</span>
              </div>
            </div>
            {previouslyOwnedCount > 0 && (
              <div className="filter-group">
                <div className="filter-group-label">Owned Status</div>
                <div className="filter-group-controls">
                  <button
                    className={`seg-btn${!showPreviouslyOwned ? " active" : ""}`}
                    onClick={() => {
                      if (showPreviouslyOwned) toggleOwnership();
                    }}
                  >
                    Owned only
                  </button>
                  <button
                    className={`seg-btn${showPreviouslyOwned ? " active" : ""}`}
                    onClick={() => {
                      if (!showPreviouslyOwned) toggleOwnership();
                    }}
                  >
                    + Prev Owned
                  </button>
                </div>
                <div className="filter-group-hint">{previouslyOwnedCount} previously owned</div>
              </div>
            )}
          </div>
        )}

        {/* Active filter chips (REQ-CFS-17) */}
        {hasAnyFilter && (
          <div className="active-chips-row">
            <span className="chips-label">Active:</span>
            {hasSearch && (
              <span className="filter-chip chip-search">
                &ldquo;{filters.search}&rdquo;{" "}
                <button className="chip-x" onClick={() => updateFilter("search", "")}>
                  &times;
                </button>
              </span>
            )}
            {hasPlayedFilter && (
              <span className="filter-chip chip-played">
                {filters.playedStatus === "played" ? "Played only" : "Unplayed only"}{" "}
                <button className="chip-x" onClick={() => updateFilter("playedStatus", "all")}>
                  &times;
                </button>
              </span>
            )}
            {hasRatedFilter && (
              <span className="filter-chip chip-rated">
                {filters.ratedStatus === "rated" ? "Rated only" : "Unrated only"}{" "}
                <button className="chip-x" onClick={() => updateFilter("ratedStatus", "all")}>
                  &times;
                </button>
              </span>
            )}
            {hasPlayerCount && (
              <span className="filter-chip chip-spec">
                {filters.playerCount} players{" "}
                <button
                  className="chip-x"
                  onClick={() => {
                    updateFilter("playerCount", null);
                    setPlayerCountInput("");
                  }}
                >
                  &times;
                </button>
              </span>
            )}
            {showPreviouslyOwned && (
              <span className="filter-chip chip-prev-owned">
                Prev Owned{" "}
                <button className="chip-x" onClick={toggleOwnership}>
                  &times;
                </button>
              </span>
            )}
            {missingDimensionsOnly && (
              <span className="filter-chip chip-missing-dimensions">
                Missing dimensions{" "}
                <button className="chip-x" onClick={clearMissingDimensions}>
                  &times;
                </button>
              </span>
            )}
            {(hasSearch ? 1 : 0) +
              (hasRatedFilter ? 1 : 0) +
              (hasPlayedFilter ? 1 : 0) +
              (hasPlayerCount ? 1 : 0) +
              (showPreviouslyOwned ? 1 : 0) +
              (missingDimensionsOnly ? 1 : 0) >=
              2 && (
              <button
                className="clear-all-link"
                onClick={() => {
                  clearAllFilters();
                  if (showPreviouslyOwned || missingDimensionsOnly) {
                    router.push("/collection");
                  }
                }}
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Capacity indicator (REQ-SHELF-30) — last child of filter-bar */}
        {capacity ? <CapacityIndicator capacity={capacity} /> : null}
      </div>

      {/* Info banner when previously-owned games are visible */}
      {showPreviouslyOwned && (
        <div className="view-notice">
          <span className="view-notice-icon">&#x2139;</span>
          Previously-owned games are shown. Niche and redundancy data reflects only your current
          shelf.
        </div>
      )}

      {/* Stats strip (REQ-CFS-19) */}
      <div className="stats-strip">
        <div className="stat-block">
          <div className="stat-value">
            {hasAnyFilter ? `${filtered.length} of ${totalGames}` : totalGames}
          </div>
          <div className="stat-label">Games</div>
        </div>
        <div className="stat-block">
          <div className="stat-value score">
            {avgFitness !== null ? avgFitness.toFixed(1) : "-"}
          </div>
          <div className="stat-label">Avg Fitness</div>
        </div>
        <div className="stat-block">
          <div className="stat-value">{ratedCount}</div>
          <div className="stat-label">Rated</div>
        </div>
        <div className="stat-block">
          <div className="stat-value">{axes.length}</div>
          <div className="stat-label">Axes</div>
        </div>

        {/* Predictions toggle */}
        {predictedGames && (
          <>
            <div className="stat-block">
              <div className="predictions-toggle" onClick={() => setPredictionsOn((v) => !v)}>
                <div className={`predictions-toggle-switch${usePredictions ? " active" : ""}`} />
                <span className="predictions-toggle-label">Predictions</span>
              </div>
              {usePredictions && (
                <div className="stat-block inner">
                  <div className="stat-value predictions-stat">{predictedCount}</div>
                  <div className="stat-label">Predicted</div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Show Niches toggle (REQ-NICHE-22) */}
        {nicheGames && (
          <>
            <div className="stat-block">
              <div
                className="predictions-toggle"
                onClick={() => {
                  setNichesOn((v) => {
                    if (v) setNicheViewMode(false);
                    return !v;
                  });
                }}
              >
                <div
                  className={`predictions-toggle-switch${nichesOn ? " active niche-toggle" : ""}`}
                />
                <span className="predictions-toggle-label">Niches</span>
              </div>
              {nichesOn && (
                <div className="predictions-toggle" onClick={() => setNicheViewMode((v) => !v)}>
                  <div
                    className={`predictions-toggle-switch${nicheViewMode ? " active niche-toggle" : ""}`}
                  />
                  <span className="predictions-toggle-label">Group</span>
                </div>
              )}
            </div>
          </>
        )}

        {hasAnyFilter && hiddenCount > 0 && (
          <div className="filtered-note">Filtered, {hiddenCount} games hidden</div>
        )}
      </div>

      {/* Table header with clickable columns */}
      <div className="collection-header">
        <div className="rank">#</div>
        <div className="game-thumb-col"></div>
        <div
          className={`col-label sortable${sort.field === "name" ? " sort-active" : ""}`}
          onClick={handleGameHeaderClick}
          style={{ justifyContent: "flex-start" }}
        >
          Game
          {sort.field === "name" && <span className="sort-arrow">{dirArrow}</span>}
        </div>
        {!usePredictions && (
          <div className="axes-used-col col-label">{isAxisSort ? "Scores" : "Axes Rated"}</div>
        )}
        {usePredictions && <div className="axes-used-col col-label">Confidence</div>}
        <div
          className={`last-rated-col col-label sortable${sort.field === "updatedAt" ? " sort-active" : ""}`}
          onClick={handleLastRatedHeaderClick}
        >
          Last Rated
          {sort.field === "updatedAt" && <span className="sort-arrow">{dirArrow}</span>}
        </div>
        <div
          className="score-col-label sortable"
          onClick={handleScoreHeaderClick}
          style={{ cursor: "pointer" }}
        >
          <span className={`score-col-main${scoreOwnsSort ? " sort-active" : ""}`}>
            Score
            {scoreOwnsSort && <span className="sort-arrow">{dirArrow}</span>}
          </span>
          <span className="score-col-sub">
            {usePredictions && sort.field === "fitness" ? (
              <span style={{ color: "var(--predict-accent)" }}>Pred. Fitness</span>
            ) : (
              scoreSubtitle
            )}
          </span>
        </div>
      </div>

      {nicheViewMode && nichesOn ? (
        /* Group by Niche view (REQ-NICHE-24, REQ-NICHE-25) */
        <>
          {nicheGroups.length > 0 ? (
            nicheGroups.map((group) => (
              <div key={`${group.type}:${group.name}`} className="niche-group">
                <div className="niche-group-header">
                  <span className="niche-group-name">{group.name}</span>
                  <span className={`niche-type-badge niche-type-${group.type}`}>{group.type}</span>
                  <span className="niche-group-count">
                    {group.games.length} game{group.games.length !== 1 ? "s" : ""}
                  </span>
                  <NicheIgnoreButton
                    type={group.type as NicheTagFilter["type"]}
                    name={group.name}
                  />
                </div>
                {group.games.map((gws, i) => {
                  const nicheEntry = gws.nichePosition?.niches.find(
                    (n) => n.type === group.type && n.name === group.name,
                  );
                  return (
                    <GameRow
                      key={gws.game.id}
                      gws={gws}
                      rank={i + 1}
                      sortField={sort.field}
                      tournamentStats={tournamentStats}
                      axisMap={axisMap}
                      axes={axes}
                      isAxisSort={isAxisSort}
                      showConfidence={usePredictions}
                      nicheHighlight={nicheEntry?.isChampion ? "champion" : undefined}
                      nicheSummary={null}
                      isIntegratedRedundancy={isIntegratedRedundancy}
                      href={buildCollectionGameHref(gws.game.id, null)}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            <div className="niche-empty">
              No niches found with 2 or more games in the filtered set.
            </div>
          )}
          {ignoredTags.length > 0 && (
            <div className="niche-ignored-section">
              <div className="niche-ignored-title">Ignored Niches</div>
              <div className="niche-ignored-chips">
                {ignoredTags.map((tag) => (
                  <span key={`${tag.type}:${tag.name}`} className="niche-ignored-chip">
                    <span className="niche-ignored-chip-name">{tag.name}</span>
                    <span className={`niche-type-badge niche-type-${tag.type}`}>{tag.type}</span>
                    <NicheRestoreButton type={tag.type} name={tag.name} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Rows with value */}
          {withValue.map((gws, i) => (
            <GameRow
              key={gws.game.id}
              gws={gws}
              rank={i + 1}
              sortField={sort.field}
              tournamentStats={tournamentStats}
              axisMap={axisMap}
              axes={axes}
              isAxisSort={isAxisSort}
              showConfidence={usePredictions}
              nicheSummary={nichesOn ? (gws.nichePosition ?? null) : null}
              isIntegratedRedundancy={isIntegratedRedundancy}
              href={buildCollectionGameHref(gws.game.id, navigationContextKey)}
              focusId={collectionRowId(gws.game.id)}
            />
          ))}

          {/* Separator */}
          {separatorLabel && (
            <div className="section-sep">
              <span className="section-sep-label">{separatorLabel}</span>
              <span className="section-sep-line" />
            </div>
          )}

          {/* Rows without value */}
          {withoutValue.map((gws) => (
            <GameRow
              key={gws.game.id}
              gws={gws}
              rank={null}
              sortField={sort.field}
              tournamentStats={tournamentStats}
              axisMap={axisMap}
              axes={axes}
              isAxisSort={isAxisSort}
              showConfidence={usePredictions}
              nicheSummary={nichesOn ? (gws.nichePosition ?? null) : null}
              isIntegratedRedundancy={isIntegratedRedundancy}
              href={buildCollectionGameHref(gws.game.id, navigationContextKey)}
              focusId={collectionRowId(gws.game.id)}
            />
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// GameRow sub-component
// ---------------------------------------------------------------------------

interface GameRowProps {
  gws: GameWithPurchaseUtilization;
  rank: number | null;
  sortField: string;
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
  axisMap: Map<string, Axis>;
  axes: Axis[];
  isAxisSort: boolean;
  showConfidence: boolean;
  nicheSummary?: import("@shelf-judge/shared").NichePosition | null;
  nicheHighlight?: "champion";
  isIntegratedRedundancy: boolean;
  href: string;
  focusId?: string;
}

function GameRow({
  gws,
  rank,
  sortField,
  tournamentStats,
  axisMap,
  axes,
  isAxisSort,
  showConfidence,
  isIntegratedRedundancy,
  nicheSummary,
  nicheHighlight,
  href,
  focusId,
}: GameRowProps) {
  const { game, score } = gws;
  const display = getScoreDisplay(gws, sortField, tournamentStats, axes);
  const isPredictedOnly =
    score !== null && score.predictionMeta !== null && score.ratedAxisCount === 0;
  const hasPrediction = score?.predictionMeta !== null && score?.predictionMeta !== undefined;
  const isUnrated = score === null && rank === null;
  const isUtilizationSort =
    sortField === "valueRemaining" || sortField === "estimatedAdditionalPlays";

  const ratedAxisIds = Object.keys(game.ratings);
  const ratedAxisNames = ratedAxisIds
    .map((id) => axisMap.get(id)?.name)
    .filter((name): name is string => name !== undefined);
  const visibleAxes = ratedAxisNames.slice(0, 3);
  const extraCount = ratedAxisNames.length - visibleAxes.length;

  const nicheCount = nicheSummary?.niches.length ?? 0;
  const championCount = nicheSummary?.niches.filter((n) => n.isChampion).length ?? 0;

  const isPrevOwned = game.ownership === "previously-owned";

  const rowClass = [
    "game-row",
    isUnrated || isPredictedOnly ? " unrated" : "",
    isPredictedOnly ? " predicted-row" : "",
    nicheHighlight === "champion" ? " niche-champion-row" : "",
    isPrevOwned ? " prev-owned" : "",
  ].join("");

  return (
    <Link
      href={href}
      id={focusId}
      className={rowClass}
      onClick={href.includes("collectionContext=") ? preserveCollectionScrollPosition : undefined}
    >
      <div className="rank">{rank !== null ? rank : "\u2014"}</div>
      <div className="game-thumb-col">
        {game.imageUrl ? (
          <img src={game.imageUrl} alt="" className="game-thumb" />
        ) : (
          <div className="game-thumb-placeholder" />
        )}
      </div>
      <div className="game-info">
        <div className="game-name">
          {game.name}
          {isPredictedOnly && <span className="predicted-label">&middot; not rated</span>}
        </div>
        {isPrevOwned && <span className="badge-prev-owned">Prev Owned</span>}
        <div className="game-meta">
          {game.numPlays != null && game.numPlays > 0 && <span>x{game.numPlays}</span>}
          {game.yearPublished && <span>{game.yearPublished}</span>}
          {game.minPlayers != null && game.maxPlayers != null && (
            <span>
              {game.minPlayers === game.maxPlayers
                ? `${game.minPlayers}p`
                : `${game.minPlayers}-${game.maxPlayers}p`}
            </span>
          )}
          {game.bggData && <span className="bgg-badge">BGG</span>}
        </div>
        {/* Compact niche summary (REQ-NICHE-23) */}
        {nicheCount > 0 && (
          <div className="game-niche-summary">
            {nicheCount} niche{nicheCount !== 1 ? "s" : ""}
            {championCount > 0 && `, champion of ${championCount}`}
          </div>
        )}
      </div>
      {!showConfidence && (
        <div className="axes-used">
          {isAxisSort ? (
            <AxisSortAltScores gws={gws} tournamentStats={tournamentStats} />
          ) : isUnrated || isPredictedOnly ? (
            <span className="no-ratings">{isPredictedOnly ? "Predicted" : "No ratings yet"}</span>
          ) : (
            <>
              {visibleAxes.map((name) => (
                <span key={name} className="axis-chip">
                  {name}
                </span>
              ))}
              {extraCount > 0 && <span className="axis-chip-more">+{extraCount}</span>}
            </>
          )}
        </div>
      )}
      {showConfidence && (
        <div className="axes-used">
          {hasPrediction ? (
            <ConfidencePill level={score.predictionMeta?.confidence ?? "insufficient"} />
          ) : score ? (
            <ConfidencePill level="actual" />
          ) : (
            <span className="breakdown-dash">&mdash;</span>
          )}
        </div>
      )}
      <div className="last-rated">{relativeDate(game.updatedAt)}</div>
      <div className="score-cell">
        <div className="score-cell-inner">
          {isUtilizationSort ? (
            <span className={display.className}>{display.text}</span>
          ) : score?.vetoed ? (
            <div className="score-vetoed-cell">
              <span className="vetoed-badge">VETOED</span>
              {gws.displayScore !== null && (
                <span className="vetoed-hypothetical">{gws.displayScore}</span>
              )}
            </div>
          ) : isPredictedOnly ? (
            <span className="score-predicted-inline">
              <span className="score-predicted-tilde-inline">~</span>
              {gws.displayScore ?? display.text}
            </span>
          ) : display.className === "score-unrated" ? (
            <span className="score-unrated">{display.text}</span>
          ) : (
            <span className={`${display.className} ${display.dotClass ? display.dotClass : ""}`}>
              {display.text}
            </span>
          )}
          {display?.isFitnessValue &&
            score?.redundancyAdjustment &&
            score.redundancyAdjustment.penalty > 0 && (
              <RedundancyBadge
                penalty={score.redundancyAdjustment.penalty}
                isIntegrated={isIntegratedRedundancy}
              />
            )}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Confidence pill for collection table
// ---------------------------------------------------------------------------

function ConfidencePill({ level }: { level: string }) {
  const label =
    level === "actual"
      ? "Actual"
      : level === "strong"
        ? "Strong"
        : level === "moderate"
          ? "Moderate"
          : level === "weak"
            ? "Weak"
            : "Insufficient";

  return <span className={`conf-badge conf-${level}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Alternate axes column when sorting by axis (REQ-CFS-10)
// ---------------------------------------------------------------------------

function AxisSortAltScores({
  gws,
  tournamentStats,
}: {
  gws: GameWithPurchaseUtilization;
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
}) {
  const { game, score } = gws;
  const eloStats = tournamentStats[game.id];
  return (
    <span className="axis-sort-alt">
      {score ? (
        score.vetoed ? (
          <span className="axis-sort-fitness">
            <span className="vetoed-badge-small">V</span>
            {gws.displayScore ?? "--"}
          </span>
        ) : (
          <span className="axis-sort-fitness">
            <span className={`score-dot ${scoreRangeClass(score.score)}`} />
            {gws.displayScore ?? "--"}
          </span>
        )
      ) : (
        <span className="axis-sort-fitness muted">--</span>
      )}
      {eloStats && <span className="axis-sort-elo">{eloStats.displayLabel}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Redundancy penalty badge for collection rows (REQ-REDUN-34, REQ-REDUN-35)
// ---------------------------------------------------------------------------

function RedundancyBadge({ penalty, isIntegrated }: { penalty: number; isIntegrated: boolean }) {
  return (
    <span className={`redundancy-badge${isIntegrated ? " integrated" : " annotation"}`}>
      {isIntegrated ? `-${penalty.toFixed(1)}` : `(-${penalty.toFixed(1)})`}
    </span>
  );
}
