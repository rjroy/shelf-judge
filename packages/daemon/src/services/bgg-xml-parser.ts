import { XMLParser } from "fast-xml-parser";
import { createCompleteEntityMetadata } from "@shelf-judge/shared";
import type {
  BggGameData,
  BggTag,
  BggEntityLink,
  EntityMetadataByClass,
  SuggestedPlayerCount,
  BggSearchResult,
} from "@shelf-judge/shared";

type BggRequestObservation = NonNullable<BggSearchResult["searchObservation"]>;

type BggXmlNameEntry = BggXmlAttribute & Record<string, string>;
type BggXmlLinkEntry = BggXmlAttribute & Record<string, string>;

interface BggXmlAttribute {
  "@_id"?: string;
  "@_type"?: string;
  "@_value"?: string;
  "@_name"?: string;
  "@_numplayers"?: string;
  "@_numvotes"?: string;
  "@_objectid"?: string;
}

interface BggXmlValueElement {
  "@_value"?: string;
}

export interface BggCollectionItem {
  bggId: number;
  name: string;
  yearPublished: number | null;
  numplays: number | null;
  playCountObservation?: BggRequestObservation;
}

export type SuggestedPlayerPollState = "absent" | "empty" | "unusable" | "usable";

export interface ParsedSuggestedPlayerPoll {
  buckets: SuggestedPlayerCount[];
  state: SuggestedPlayerPollState;
  observation?: BggRequestObservation;
}

// Interfaces for the parsed XML structure from fast-xml-parser.
// The parser returns untyped objects; these capture the shapes we actually access.

interface BggXmlPollResult extends BggXmlAttribute {
  result?: BggXmlAttribute[];
}

interface BggXmlPoll extends BggXmlAttribute {
  results?: BggXmlPollResult[];
}

interface BggXmlRatings {
  average?: BggXmlValueElement;
  bayesaverage?: BggXmlValueElement;
  averageweight?: BggXmlValueElement;
  numweights?: BggXmlValueElement;
}

interface BggXmlItem extends BggXmlAttribute {
  name?: BggXmlNameEntry[];
  link?: BggXmlLinkEntry[];
  statistics?: { ratings?: BggXmlRatings };
  poll?: BggXmlPoll[];
  yearpublished?: BggXmlValueElement;
  minplayers?: BggXmlValueElement;
  maxplayers?: BggXmlValueElement;
  playingtime?: BggXmlValueElement;
  description?: string;
  image?: string;
  thumbnail?: string;
  "#text"?: string;
  rank?: BggXmlAttribute[];
}

interface BggXmlCollectionItem extends BggXmlAttribute {
  name?: BggXmlNameEntry[] | BggXmlNameEntry | string | number;
  yearpublished?: number | string;
  numplays?: number | string;
}

interface BggXmlDocument {
  items?: { item?: BggXmlItem[] };
}

interface BggXmlCollectionDocument {
  items?: { item?: BggXmlCollectionItem[] };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["item", "link", "name", "results", "result", "rank"].includes(name),
});

function cleanupString(value: string | undefined): string {
  return value?.replace(/&#039;/g, "'") ?? "";
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function parseNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function extractPrimaryName(names: BggXmlNameEntry[]): string {
  const primary = names.find((n) => n["@_type"] === "primary");
  const value = primary?.["@_value"] ?? names[0]?.["@_value"] ?? "Unknown";
  return cleanupString(value);
}

function extractLinks(links: BggXmlLinkEntry[], type: string): BggTag[] {
  return links
    .filter((l) => l["@_type"] === type)
    .map((l) => ({
      id: Number(l["@_id"]),
      name: cleanupString(l["@_value"]),
    }));
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function compareEntityNames(left: string, right: string): number {
  return (
    compareCodePoints(left.normalize("NFC"), right.normalize("NFC")) ||
    compareCodePoints(left, right)
  );
}

function extractEntityLinks(links: BggXmlLinkEntry[], type: string): BggEntityLink[] {
  const byId = new Map<number, string>();
  for (const link of links) {
    if (link["@_type"] !== type) continue;
    const id = Number(link["@_id"]);
    const name = cleanupString(link["@_value"]).trim();
    if (!Number.isSafeInteger(id) || id <= 0 || name.length === 0) continue;
    const currentName = byId.get(id);
    if (currentName === undefined || compareEntityNames(name, currentName) < 0) byId.set(id, name);
  }
  return [...byId]
    .sort(([leftId], [rightId]) => leftId - rightId)
    .map(([id, name]) => ({ id, name }));
}

function entityMetadata(links: BggXmlLinkEntry[], observedAt: string): EntityMetadataByClass {
  return createCompleteEntityMetadata(
    {
      mechanic: extractEntityLinks(links, "boardgamemechanic"),
      designer: extractEntityLinks(links, "boardgamedesigner"),
      artist: extractEntityLinks(links, "boardgameartist"),
    },
    observedAt,
  );
}

function extractSuggestedPlayerPoll(poll: BggXmlPoll | undefined): ParsedSuggestedPlayerPoll {
  if (!poll) return { buckets: [], state: "absent" };
  const allResults = ensureArray(poll.results);
  if (allResults.length === 0) return { buckets: [], state: "empty" };

  let hasUsableBucket = false;
  const buckets = allResults.map((r) => {
    const playerCount = r["@_numplayers"] ?? "?";
    const votes = ensureArray(r.result);
    const hasRecognizedVote = votes.some(
      (vote) =>
        vote["@_value"] === "Best" ||
        vote["@_value"] === "Recommended" ||
        vote["@_value"] === "Not Recommended",
    );
    if (r["@_numplayers"] !== undefined && hasRecognizedVote) hasUsableBucket = true;
    const best = Number(votes.find((v) => v["@_value"] === "Best")?.["@_numvotes"]) || 0;
    const recommended =
      Number(votes.find((v) => v["@_value"] === "Recommended")?.["@_numvotes"]) || 0;
    const notRecommended =
      Number(votes.find((v) => v["@_value"] === "Not Recommended")?.["@_numvotes"]) || 0;
    return { playerCount, best, recommended, notRecommended };
  });

  return { buckets, state: hasUsableBucket ? "usable" : "unusable" };
}

function extractBestPlayerCount(suggestedPlayerCounts: SuggestedPlayerCount[]): number | null {
  if (suggestedPlayerCounts.length == 0) return null;
  let best: number | null = null;
  let votes: number | null = null;
  let count: number | null = null;

  for (const suggestion of suggestedPlayerCounts) {
    const bucket = /^\s*(\d+)(?:\+)?\s*$/.exec(suggestion.playerCount);
    const playerCount = bucket === null ? null : Number(bucket[1]);
    if (
      suggestion.best > 0 &&
      playerCount !== null &&
      Number.isSafeInteger(playerCount) &&
      playerCount > 0
    ) {
      if (votes === null || votes < suggestion.best) {
        best = playerCount;
        votes = suggestion.best;
        count = 1;
      } else if (votes == suggestion.best && best == playerCount) {
        count = count ? count + 1 : 1;
      }
    }
  }

  return best && count ? best / count : null;
}

function observation(
  sourceRequest: BggRequestObservation["sourceRequest"],
  observedAt: string,
  state: BggRequestObservation["state"],
  fieldsReturned: string[],
): BggRequestObservation {
  return { sourceRequest, observedAt, state, fieldsReturned };
}

function assertBggXml(parsed: { items?: unknown }, context: string): void {
  if (!parsed || !("items" in parsed)) {
    throw new Error(`Malformed BGG ${context} response: missing root <items> element`);
  }
}

function parseThingItem(item: BggXmlItem, observedAt: string): ThingItem {
  const names = ensureArray(item.name);
  const links = ensureArray(item.link);
  const ratings = item.statistics?.ratings;
  const avgWeight = parseNumber(ratings?.averageweight?.["@_value"]);
  const weight = avgWeight === 0 ? null : avgWeight;
  const polls = ensureArray(item.poll);
  const playerCountPoll = polls.find((poll) => poll["@_name"] === "suggested_numplayers");
  const suggestedPlayerPoll = extractSuggestedPlayerPoll(playerCountPoll);
  const parsedEntityMetadata = entityMetadata(links, observedAt);
  suggestedPlayerPoll.observation = observation(
    "bgg-thing",
    observedAt,
    suggestedPlayerPoll.state === "absent" ? "absent" : "complete",
    suggestedPlayerPoll.state === "absent" ? [] : ["suggestedPlayerCounts"],
  );

  const minPlayers = parseNumber(item.minplayers?.["@_value"]);
  const maxPlayers = parseNumber(item.maxplayers?.["@_value"]);
  const rangeFields = [
    ...(item.minplayers === undefined ? [] : ["minPlayers"]),
    ...(item.maxplayers === undefined ? [] : ["maxPlayers"]),
  ];
  const rangeState =
    rangeFields.length === 0 ? "absent" : rangeFields.length === 2 ? "complete" : "partial";
  const hasName = names.some((name) => name["@_value"] !== undefined);
  const metadataFields = [
    ...(hasName ? ["name"] : []),
    ...(item.yearpublished?.["@_value"] === undefined ? [] : ["yearPublished"]),
    ...rangeFields,
    ...(item.playingtime?.["@_value"] === undefined ? [] : ["playingTime"]),
    ...(item.image === undefined ? [] : ["imageUrl"]),
    ...(item.thumbnail === undefined ? [] : ["thumbnailUrl"]),
    ...(ratings === undefined ? [] : ["bggData"]),
  ];
  const expectedMetadataFieldCount = 8;
  const metadataState =
    metadataFields.length === 0
      ? "absent"
      : metadataFields.length === expectedMetadataFieldCount
        ? "complete"
        : "partial";

  return {
    bggId: Number(item["@_id"]),
    metadata: {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber(item.yearpublished?.["@_value"]),
      minPlayers,
      maxPlayers,
      playingTime: parseNumber(item.playingtime?.["@_value"]),
      imageUrl: item.image ?? null,
      thumbnailUrl: item.thumbnail ?? null,
    },
    metadataObservation: observation("bgg-thing", observedAt, metadataState, metadataFields),
    playerRangeObservation: observation("bgg-thing", observedAt, rangeState, rangeFields),
    suggestedPlayerPoll,
    bggData: {
      communityRating: parseNumber(ratings?.average?.["@_value"]) ?? 0,
      bayesAverage: parseNumber(ratings?.bayesaverage?.["@_value"]) ?? 0,
      weight,
      numWeightVotes: parseNumber(ratings?.numweights?.["@_value"]) ?? 0,
      description: item.description ?? null,
      mechanics: parsedEntityMetadata.mechanic.entities,
      categories: extractLinks(links, "boardgamecategory"),
      families: extractLinks(links, "boardgamefamily"),
      subdomains: extractLinks(links, "boardgamesubdomain"),
      bestPlayerCount: extractBestPlayerCount(suggestedPlayerPoll.buckets),
      fetchedAt: observedAt,
    },
    entityMetadata: parsedEntityMetadata,
  };
}

function parseThingDocument(xml: string, observedAt: string): ThingItem[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "thing");
  const items = ensureArray(parsed?.items?.item);
  return items.map((item) => parseThingItem(item, observedAt));
}

export function parseThingResponse(
  xml: string,
  observedAt = new Date().toISOString(),
): BggGameData[] {
  return parseThingDocument(xml, observedAt).map((item) => item.bggData);
}

export interface ThingMetadata {
  bggId: number;
  name: string;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
}

export interface CollectiomItemMetadata {
  numPlays: number | null;
  observation?: BggRequestObservation;
}

export function parseThingMetadata(xml: string): ThingMetadata[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "thing");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const names = ensureArray(item.name);
    return {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber(item.yearpublished?.["@_value"]),
      minPlayers: parseNumber(item.minplayers?.["@_value"]),
      maxPlayers: parseNumber(item.maxplayers?.["@_value"]),
      playingTime: parseNumber(item.playingtime?.["@_value"]),
      imageUrl: item.image ?? null,
      thumbnailUrl: item.thumbnail ?? null,
    };
  });
}

export interface ThingItem {
  bggId: number;
  metadata: ThingMetadata;
  bggData: BggGameData;
  metadataObservation: BggRequestObservation;
  playerRangeObservation: BggRequestObservation;
  suggestedPlayerPoll: ParsedSuggestedPlayerPoll;
  entityMetadata: EntityMetadataByClass;
}

export function parseThingItems(xml: string, observedAt = new Date().toISOString()): ThingItem[] {
  return parseThingDocument(xml, observedAt);
}

export function parseSearchResponse(
  xml: string,
  observedAt = new Date().toISOString(),
): BggSearchResult[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "search");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const names = ensureArray(item.name);
    const fieldsReturned = [
      ...(item["@_id"] === undefined ? [] : ["bggId"]),
      ...(names.some((name) => name["@_value"] !== undefined) ? ["name"] : []),
      ...(item.yearpublished?.["@_value"] === undefined ? [] : ["yearPublished"]),
    ];
    const state =
      fieldsReturned.length === 0 ? "absent" : fieldsReturned.length === 3 ? "complete" : "partial";
    return {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber(item.yearpublished?.["@_value"]),
      thumbnailUrl: null,
      searchObservation: observation("bgg-search", observedAt, state, fieldsReturned),
    };
  });
}

export function parseCollectionResponse(
  xml: string,
  observedAt = new Date().toISOString(),
): BggCollectionItem[] {
  const parsed = parser.parse(xml) as BggXmlCollectionDocument;
  assertBggXml(parsed, "collection");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const nameRaw = item.name;
    let nameStr: string;
    if (Array.isArray(nameRaw)) {
      // isArray config wraps <name> in an array; extract #text from first element
      const first = nameRaw[0] as BggXmlNameEntry | string | undefined;
      nameStr = typeof first === "string" ? first : (first?.["#text"] ?? "Unknown");
    } else if (typeof nameRaw === "string" || typeof nameRaw === "number") {
      nameStr = String(nameRaw);
    } else if (nameRaw != null) {
      nameStr = nameRaw["#text"] ?? "Unknown";
    } else {
      nameStr = "Unknown";
    }
    const year = item.yearpublished;
    const numplays = item.numplays;
    const parsedNumPlays = parseNumber(numplays);
    const hasNumPlays = numplays !== undefined;

    return {
      bggId: Number(item["@_objectid"]),
      name: nameStr,
      yearPublished: parseNumber(year),
      numplays: parsedNumPlays,
      playCountObservation: observation(
        "bgg-collection",
        observedAt,
        hasNumPlays ? "complete" : "absent",
        hasNumPlays ? ["numPlays"] : [],
      ),
    };
  });
}
