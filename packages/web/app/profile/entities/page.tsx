import type { Metadata } from "next";
import Link from "next/link";
import type {
  CollectionProfile,
  CollectionProfileEntityClass,
  CollectionProfileEntityClassResult,
  CollectionProfileEntityEvidence,
  CollectionProfileEntityOrderings,
} from "@shelf-judge/shared";
import { getProfile } from "@/lib/api";
import { ClassEvidence, EntityEvidence } from "@/components/profile/entity-evidence";
import { EntityExplorerFocus } from "@/components/profile/entity-explorer-focus";
import { ProfileRetry } from "@/components/profile/profile-unavailable";

export const metadata: Metadata = { title: "Entity Evidence" };
export const dynamic = "force-dynamic";

export type EntityOrdering = keyof CollectionProfileEntityOrderings;
export type EntitySupportFilter = "all" | CollectionProfileEntityEvidence["support"];
export interface EntityExplorerState {
  entityClass: CollectionProfileEntityClass;
  entityId: number | null;
  ordering: EntityOrdering;
  support: EntitySupportFilter;
  query: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

const entityClasses: CollectionProfileEntityClass[] = ["mechanic", "designer", "artist"];
const classLabels: Record<CollectionProfileEntityClass, string> = {
  mechanic: "Mechanics",
  designer: "Designers",
  artist: "Artists",
};
const resultLabels: Record<CollectionProfileEntityClassResult["result"], string> = {
  supported: "Supported",
  limited: "Limited",
  "no-eligible-ratings": "No eligible ratings",
  "evaluated-empty": "Evaluated empty",
  "not-evaluated": "Not evaluated",
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseEntityExplorerState(params: SearchParams): EntityExplorerState {
  const requestedClass = single(params.class);
  const requestedOrder = single(params.order);
  const requestedSupport = single(params.support);
  const requestedEntity = single(params.entity);
  const parsedEntity = requestedEntity?.match(/^\d+$/) ? Number(requestedEntity) : null;
  return {
    entityClass:
      requestedClass === "designer" || requestedClass === "artist" ? requestedClass : "mechanic",
    entityId: parsedEntity !== null && Number.isSafeInteger(parsedEntity) ? parsedEntity : null,
    ordering: requestedOrder === "support" || requestedOrder === "name" ? requestedOrder : "rating",
    support:
      requestedSupport === "supported" || requestedSupport === "limited" ? requestedSupport : "all",
    query: (single(params.q) ?? "").trim(),
  };
}

export function entityExplorerUrl(
  state: EntityExplorerState,
  overrides: Partial<EntityExplorerState> = {},
  fragment?: string,
): string {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams({ class: next.entityClass });
  if (next.entityId !== null) params.set("entity", String(next.entityId));
  if (next.ordering !== "rating") params.set("order", next.ordering);
  if (next.support !== "all") params.set("support", next.support);
  if (next.query !== "") params.set("q", next.query);
  return `/profile/entities?${params.toString()}${fragment === undefined ? "" : `#${fragment}`}`;
}

export function entitiesInSuppliedOrder(
  result: CollectionProfileEntityClassResult,
  ordering: EntityOrdering,
): CollectionProfileEntityEvidence[] {
  return result.orderings[ordering].flatMap((entityId) => {
    const entity = result.entities.find((candidate) => candidate.entityId === entityId);
    return entity === undefined ? [] : [entity];
  });
}

export interface EntityExplorerResult {
  entity: CollectionProfileEntityEvidence;
  matchedGameName: string | null;
}

export function filterEntityExplorerResults(
  result: CollectionProfileEntityClassResult,
  state: EntityExplorerState,
): EntityExplorerResult[] {
  const query = state.query.toLocaleLowerCase();
  return entitiesInSuppliedOrder(result, state.ordering).flatMap<EntityExplorerResult>((entity) => {
    if (state.support !== "all" && entity.support !== state.support) return [];
    if (query === "") return [{ entity, matchedGameName: null }];
    if (entity.name.toLocaleLowerCase().includes(query)) return [{ entity, matchedGameName: null }];
    const matchedGame = entity.games.find((game) =>
      game.gameName.toLocaleLowerCase().includes(query),
    );
    return matchedGame === undefined ? [] : [{ entity, matchedGameName: matchedGame.gameName }];
  });
}

function intrinsicEmptyMessage(result: CollectionProfileEntityClassResult): string {
  if (result.result === "no-eligible-ratings")
    return "Associations exist, but no associated game has eligible fitness. Review class evidence for exclusions.";
  if (result.result === "evaluated-empty")
    return "Complete metadata contains no associations in this class.";
  return "No owned game has complete metadata for this class. Review readiness and exclusions in class evidence.";
}

function hiddenInput(name: string, value: string | number | null) {
  return value === null || value === "" ? null : <input type="hidden" name={name} value={value} />;
}

export function EntityDrilldownContent({
  profile,
  state,
}: {
  profile: CollectionProfile;
  state: EntityExplorerState;
}) {
  const result = profile.identity.classes[state.entityClass];
  const results = filterEntityExplorerResults(result, state);
  const explicitEntity =
    state.entityId === null
      ? undefined
      : result.entities.find((entity) => entity.entityId === state.entityId);
  const selectedEntity = explicitEntity ?? results[0]?.entity;
  const explicitSelection = explicitEntity !== undefined;
  const selectedOutsideResults =
    explicitSelection && !results.some(({ entity }) => entity.entityId === explicitEntity.entityId);
  const excludedSearchMatch =
    state.query !== "" &&
    results.length === 0 &&
    result.exclusions.some((exclusion) =>
      exclusion.gameName.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()),
    );
  const clearFiltersUrl = entityExplorerUrl(state, {
    entityId: explicitEntity?.entityId ?? null,
    query: "",
    support: "all",
  });
  const returnUrl = entityExplorerUrl(
    state,
    {
      entityId: null,
      ...(selectedOutsideResults ? { query: "", support: "all" as const } : {}),
    },
    selectedEntity === undefined ? undefined : `entity-${selectedEntity.entityId}`,
  );

  return (
    <>
      <div className="topbar">
        <h1 className="topbar-title">Collection Entity Evidence</h1>
      </div>
      <main
        className={`main-scroll profile-page profile-drilldown entity-explorer ${explicitSelection ? "has-explicit-selection" : "results-mode"}`}
      >
        <EntityExplorerFocus
          detailHeadingId={
            explicitSelection ? `${state.entityClass}-${explicitEntity.entityId}-heading` : null
          }
        />
        <div className="entity-explorer-header">
          <nav aria-label="Profile navigation">
            <Link href="/">Back to profile</Link>
          </nav>
          <nav className="entity-class-nav" aria-label="Entity classes">
            {entityClasses.map((entityClass) => (
              <Link
                key={entityClass}
                href={entityExplorerUrl(state, {
                  entityClass,
                  entityId: null,
                  query: "",
                  support: "all",
                })}
                aria-current={state.entityClass === entityClass ? "page" : undefined}
              >
                <span>{classLabels[entityClass]}</span>
                <span>{profile.identity.classes[entityClass].entities.length}</span>
              </Link>
            ))}
          </nav>
          <section className="entity-class-summary" aria-labelledby="entity-class-heading">
            <div>
              <h2 id="entity-class-heading">{classLabels[state.entityClass]}</h2>
              <p>
                <span className="profile-status-label">{resultLabels[result.result]}</span>
                {" · "}
                {result.metadataReadiness.completeGameCount} of{" "}
                {result.metadataReadiness.ownedGameCount} games complete
              </p>
              <p className="entity-readiness-counts">
                {result.metadataReadiness.refreshNeededGameCount} refresh needed ·{" "}
                {result.metadataReadiness.unrefreshableGameCount} unrefreshable ·{" "}
                {result.exclusions.length} exclusions · {result.refreshWarnings.length} refresh
                warnings
              </p>
            </div>
            <ClassEvidence result={result} />
          </section>
        </div>

        {result.entities.length === 0 ? (
          <section className="profile-state entity-intrinsic-empty" data-result={result.result}>
            <h3>{resultLabels[result.result]}</h3>
            <p>{intrinsicEmptyMessage(result)}</p>
          </section>
        ) : (
          <>
            <section className="entity-explorer-controls" aria-label="Filter entity evidence">
              <form method="get" className="entity-search-form" role="search">
                {hiddenInput("class", state.entityClass)}
                {hiddenInput("order", state.ordering === "rating" ? null : state.ordering)}
                {hiddenInput("support", state.support === "all" ? null : state.support)}
                <label htmlFor="entity-search">Find an entity or supporting game</label>
                <div>
                  <input id="entity-search" name="q" type="search" defaultValue={state.query} />
                  <button className="btn btn-secondary" type="submit">
                    Search
                  </button>
                </div>
              </form>
              <form method="get" className="entity-select-form">
                {hiddenInput("class", state.entityClass)}
                {hiddenInput("order", state.ordering === "rating" ? null : state.ordering)}
                {hiddenInput("q", state.query)}
                <label htmlFor="entity-support">Evidence</label>
                <select id="entity-support" name="support" defaultValue={state.support}>
                  <option value="all">All evidence</option>
                  <option value="supported">Supported</option>
                  <option value="limited">Limited</option>
                </select>
                <button className="btn btn-secondary" type="submit">
                  Apply evidence filter
                </button>
              </form>
              <form method="get" className="entity-select-form">
                {hiddenInput("class", state.entityClass)}
                {hiddenInput("entity", explicitEntity?.entityId ?? null)}
                {hiddenInput("support", state.support === "all" ? null : state.support)}
                {hiddenInput("q", state.query)}
                <label htmlFor="entity-order">Order</label>
                <select id="entity-order" name="order" defaultValue={state.ordering}>
                  <option value="rating">Rating</option>
                  <option value="support">Support</option>
                  <option value="name">Name</option>
                </select>
                <button className="btn btn-secondary" type="submit">
                  Apply order
                </button>
              </form>
              <p className="entity-result-count" aria-live="polite">
                {results.length} {results.length === 1 ? "result" : "results"}
              </p>
            </section>

            <div className="entity-explorer-workspace">
              <section className="entity-index" aria-labelledby="entity-index-heading">
                <div className="entity-index-heading">
                  <h3 id="entity-index-heading">Entity index</h3>
                  <span>Mean</span>
                  <span>vs collection</span>
                </div>
                {results.length === 0 ? (
                  <div className="entity-filtered-empty">
                    <p>
                      {excludedSearchMatch
                        ? "That game is excluded from this class's entity evidence."
                        : "No entities match the current search and evidence filter."}
                    </p>
                    {excludedSearchMatch && <a href="#class-evidence">Review class evidence</a>}
                    <Link href={clearFiltersUrl}>Clear search and filters</Link>
                  </div>
                ) : (
                  <div
                    className="entity-index-scroll"
                    role="region"
                    aria-label="Entity results"
                    tabIndex={0}
                  >
                    <ul>
                      {results.map(({ entity, matchedGameName }) => {
                        const selected = selectedEntity?.entityId === entity.entityId;
                        return (
                          <li key={entity.entityId}>
                            <Link
                              id={`entity-${entity.entityId}`}
                              href={entityExplorerUrl(state, { entityId: entity.entityId })}
                              className="entity-index-row"
                              aria-current={selected ? "true" : undefined}
                            >
                              <strong>{entity.name}</strong>
                              <span className="entity-index-score">
                                <span className="sr-only">Mean current fitness </span>
                                {entity.meanCurrentFitness.toFixed(1)}
                              </span>
                              <span className="entity-index-delta">
                                <span className="sr-only">Difference from collection </span>
                                {entity.differenceFromComparator > 0 ? "+" : ""}
                                {entity.differenceFromComparator.toFixed(1)}
                              </span>
                              <span className="entity-index-meta">
                                {entity.associatedGameCount}{" "}
                                {entity.associatedGameCount === 1 ? "game" : "games"} ·{" "}
                                {entity.support}
                              </span>
                              {matchedGameName !== null && (
                                <span className="entity-index-match">
                                  Matched supporting game: {matchedGameName}
                                </span>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>

              {selectedEntity !== undefined && (
                <section className="entity-selected-detail" aria-label="Selected evidence">
                  {explicitSelection && (
                    <Link className="entity-back-to-results" href={returnUrl}>
                      {selectedOutsideResults ? "Clear filters and return" : "Back"} to{" "}
                      {classLabels[state.entityClass]} results
                    </Link>
                  )}
                  {selectedOutsideResults && (
                    <p className="entity-outside-results">
                      Selected entity is outside the current results.{" "}
                      <Link href={clearFiltersUrl}>Clear search and filters</Link>
                    </p>
                  )}
                  <EntityEvidence entity={selectedEntity} entityClass={state.entityClass} />
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}

export default async function EntityDrilldownPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = parseEntityExplorerState(await searchParams);
  try {
    const profile = await getProfile();
    if (profile.status === "unavailable") {
      return (
        <>
          <div className="topbar">
            <h1 className="topbar-title">Collection Entity Evidence</h1>
          </div>
          <main className="main-scroll profile-page">
            <ProfileRetry message={profile.error.message} />
          </main>
        </>
      );
    }
    return <EntityDrilldownContent profile={profile} state={state} />;
  } catch (error) {
    return (
      <>
        <div className="topbar">
          <h1 className="topbar-title">Collection Entity Evidence</h1>
        </div>
        <main className="main-scroll profile-page">
          <ProfileRetry
            message={error instanceof Error ? error.message : "The profile request failed."}
          />
        </main>
      </>
    );
  }
}
