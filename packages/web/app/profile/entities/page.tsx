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
import { ProfileRetry } from "@/components/profile/profile-unavailable";

export const metadata: Metadata = { title: "Entity Evidence" };
export const dynamic = "force-dynamic";

export type EntityOrdering = keyof CollectionProfileEntityOrderings;

const entityClasses: CollectionProfileEntityClass[] = ["mechanic", "designer", "artist"];
const classLabels: Record<CollectionProfileEntityClass, string> = {
  mechanic: "Mechanics",
  designer: "Designers",
  artist: "Artists",
};

export function entitiesInSuppliedOrder(
  result: CollectionProfileEntityClassResult,
  ordering: EntityOrdering,
): CollectionProfileEntityEvidence[] {
  return result.orderings[ordering].flatMap((entityId) => {
    const entity = result.entities.find((candidate) => candidate.entityId === entityId);
    return entity === undefined ? [] : [entity];
  });
}

export function EntityDrilldownContent({
  profile,
  ordering,
}: {
  profile: CollectionProfile;
  ordering: EntityOrdering;
}) {
  return (
    <>
      <div className="topbar">
        <h1 className="topbar-title">Collection Entity Evidence</h1>
      </div>
      <main className="main-scroll profile-page profile-drilldown">
        <nav aria-label="Profile navigation">
          <Link href="/">Back to profile</Link>
        </nav>
        <form className="profile-order-control" method="get">
          <label htmlFor="entity-order">Order every entity by</label>
          <select id="entity-order" name="order" defaultValue={ordering}>
            <option value="rating">Rating</option>
            <option value="support">Support</option>
            <option value="name">Name</option>
          </select>
          <button className="btn btn-secondary" type="submit">
            Apply order
          </button>
        </form>
        {entityClasses.map((entityClass) => {
          const result = profile.identity.classes[entityClass];
          return (
            <section
              key={entityClass}
              id={entityClass}
              className="entity-class-drilldown"
              aria-labelledby={`${entityClass}-heading`}
            >
              <h2 id={`${entityClass}-heading`}>{classLabels[entityClass]}</h2>
              <p className="profile-status-label">Result: {result.result}</p>
              <ClassEvidence result={result} />
              {result.entities.length === 0 ? (
                <p className="profile-state" data-result={result.result}>
                  No entity records are available for this evaluated state.
                </p>
              ) : (
                <div className="entity-evidence-list" data-ordering={ordering}>
                  {entitiesInSuppliedOrder(result, ordering).map((entity) => (
                    <EntityEvidence
                      key={entity.entityId}
                      entity={entity}
                      entityClass={entityClass}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}

export default async function EntityDrilldownPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const requested = (await searchParams).order;
  const ordering: EntityOrdering =
    requested === "support" || requested === "name" ? requested : "rating";
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
    return <EntityDrilldownContent profile={profile} ordering={ordering} />;
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
