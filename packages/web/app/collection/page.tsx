import type { Metadata } from "next";
import { CollectionSnapshotBoundary } from "@/components/collection-snapshot-boundary";
import { parseDimensionStatusParameter } from "@/lib/collection-navigation-context";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

function singularParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const collectionContext = singularParam(params.collectionContext);
  const collectionOrigin = singularParam(params.collectionOrigin);

  return (
    <>
      <CollectionSnapshotBoundary
        showPreviouslyOwned={params.ownership === "all"}
        dimensionStatus={parseDimensionStatusParameter(params.dimensions)}
        collectionContext={collectionContext}
        collectionOrigin={collectionOrigin}
        collectionReturnAttempt={
          params.collectionContext !== undefined || params.collectionOrigin !== undefined
        }
      />
      <noscript>
        <style>{`.collection-snapshot-status--loading { display: none !important; }`}</style>
        <p>
          JavaScript is required to load and use your Collection. Enable JavaScript and reload this
          page.
        </p>
      </noscript>
    </>
  );
}
