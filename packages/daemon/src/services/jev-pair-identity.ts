import { createHash } from "node:crypto";

import type { JevDependencyKind, JevPairDependency } from "./jev-pair-cache-service.js";

export interface WishlistBggMemberIdentity {
  kind: "wishlist-bgg";
  collectionId: string;
  bggId: string;
}

export interface OwnedLocalMemberIdentity {
  kind: "owned-local";
  collectionId: string;
  localGameId: string;
}

export type WishlistCandidateMemberIdentity = WishlistBggMemberIdentity | OwnedLocalMemberIdentity;

/** JSON tuple encoding is reversible and cannot collide with an arbitrary raw local ID. */
export function encodeWishlistBggMember(collectionId: string, bggId: string): string {
  requireIdentityPart(collectionId, "collection ID");
  requireIdentityPart(bggId, "BGG ID");
  return JSON.stringify(["wishlist-bgg", collectionId, bggId]);
}

export function encodeOwnedLocalMember(collectionId: string, localGameId: string): string {
  requireIdentityPart(collectionId, "collection ID");
  requireIdentityPart(localGameId, "local game ID");
  return JSON.stringify(["owned-local", collectionId, localGameId]);
}

function requireIdentityPart(value: string, name: string): void {
  if (!value.trim() || value.length > 2048) throw new Error(`Invalid ${name}`);
}

export function parseWishlistCandidateMember(
  value: string,
): WishlistCandidateMemberIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const tuple = parsed as unknown[];
  const kind = tuple[0];
  const collectionId = tuple[1];
  const memberId = tuple[2];
  if (
    typeof collectionId !== "string" ||
    typeof memberId !== "string" ||
    !collectionId.trim() ||
    !memberId.trim() ||
    collectionId.length > 2048 ||
    memberId.length > 2048
  )
    return null;
  if (kind === "wishlist-bgg") {
    if (JSON.stringify([kind, collectionId, memberId]) !== value) return null;
    return { kind, collectionId, bggId: memberId };
  }
  if (kind === "owned-local") {
    if (JSON.stringify([kind, collectionId, memberId]) !== value) return null;
    return { kind, collectionId, localGameId: memberId };
  }
  return null;
}

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
