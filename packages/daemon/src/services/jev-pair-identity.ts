import { createHash } from "node:crypto";

import type { JevDependencyKind, JevPairDependency } from "./jev-pair-cache-service.js";

/** Hashes the exact UTF-8 source sent to Jev. No trimming or normalization is permitted. */
export function fingerprintJevSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export interface JevPairSource {
  gameId: string;
  name: string;
  description?: string;
  note?: { text: string; version: string };
}

/** Produces precisely the source dependency set for an independent or shared request. */
export function buildJevPairDependencies(
  kind: JevDependencyKind,
  left: JevPairSource,
  right: JevPairSource,
): JevPairDependency[] {
  if (!left.gameId || !right.gameId || left.gameId === right.gameId) {
    throw new Error("Pair requires two distinct stable IDs");
  }

  const includeDescription = kind !== "D_ONLY";
  const includeNote = kind !== "C_ONLY";
  const makeDependency = (source: JevPairSource): JevPairDependency => {
    if (includeDescription && source.description === undefined) {
      throw new Error("Description required by Jev dependency kind");
    }
    if (includeNote && (!source.note || !source.note.version)) {
      throw new Error("Present note and version required by Jev dependency kind");
    }
    return {
      gameId: source.gameId,
      nameFingerprint: fingerprintJevSource(source.name),
      ...(includeDescription
        ? { descriptionFingerprint: fingerprintJevSource(source.description!) }
        : {}),
      ...(includeNote
        ? {
            noteFingerprint: fingerprintJevSource(source.note!.text),
            noteVersion: source.note!.version,
          }
        : {}),
    };
  };

  return [makeDependency(left), makeDependency(right)].sort((a, b) =>
    a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0,
  );
}
