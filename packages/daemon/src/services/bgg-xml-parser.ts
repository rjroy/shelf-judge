import { XMLParser } from "fast-xml-parser";
import type {
  BggGameData,
  BggTag,
  SuggestedPlayerCount,
  BggSearchResult,
} from "@shelf-judge/shared";

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

function extractSuggestedPlayerCounts(poll: BggXmlPoll | undefined): SuggestedPlayerCount[] {
  if (!poll) return [];
  const allResults = ensureArray(poll.results);
  return allResults.map((r) => {
    const playerCount = r["@_numplayers"] ?? "?";
    const votes = ensureArray(r.result);
    const best = Number(votes.find((v) => v["@_value"] === "Best")?.["@_numvotes"]) || 0;
    const recommended =
      Number(votes.find((v) => v["@_value"] === "Recommended")?.["@_numvotes"]) || 0;
    const notRecommended =
      Number(votes.find((v) => v["@_value"] === "Not Recommended")?.["@_numvotes"]) || 0;
    return { playerCount, best, recommended, notRecommended };
  });
}

function assertBggXml(parsed: { items?: unknown }, context: string): void {
  if (!parsed || !("items" in parsed)) {
    throw new Error(`Malformed BGG ${context} response: missing root <items> element`);
  }
}

export function parseThingResponse(xml: string): BggGameData[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "thing");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const links = ensureArray(item.link);
    const ratings = item.statistics?.ratings;

    const avgWeight = parseNumber(ratings?.averageweight?.["@_value"]);

    // BGG quirk: averageweight of 0 treated as null (known bug)
    const weight = avgWeight === 0 ? null : avgWeight;

    const polls = ensureArray(item.poll);
    const playerCountPoll = polls.find((p) => p["@_name"] === "suggested_numplayers");

    return {
      communityRating: parseNumber(ratings?.average?.["@_value"]) ?? 0,
      bayesAverage: parseNumber(ratings?.bayesaverage?.["@_value"]) ?? 0,
      weight,
      numWeightVotes: parseNumber(ratings?.numweights?.["@_value"]) ?? 0,
      description: item.description ?? null,
      mechanics: extractLinks(links, "boardgamemechanic"),
      categories: extractLinks(links, "boardgamecategory"),
      families: extractLinks(links, "boardgamefamily"),
      subdomains: extractLinks(links, "boardgamesubdomain"),
      suggestedPlayerCounts: extractSuggestedPlayerCounts(playerCountPoll),
      fetchedAt: new Date().toISOString(),
    };
  });
}

export interface ThingMetadata {
  bggId: number;
  name: string;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  imageUrl: string | null;
}

export interface CollectiomItemMetadata {
  numPlays: number | null;
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
    };
  });
}

export interface ThingItem {
  bggId: number;
  metadata: ThingMetadata;
  bggData: BggGameData;
}

export function parseThingItems(xml: string): ThingItem[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "thing");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const names = ensureArray(item.name);
    const links = ensureArray(item.link);
    const ratings = item.statistics?.ratings;
    const avgWeight = parseNumber(ratings?.averageweight?.["@_value"]);
    const weight = avgWeight === 0 ? null : avgWeight;
    const polls = ensureArray(item.poll);
    const playerCountPoll = polls.find((p) => p["@_name"] === "suggested_numplayers");

    return {
      bggId: Number(item["@_id"]),
      metadata: {
        bggId: Number(item["@_id"]),
        name: extractPrimaryName(names),
        yearPublished: parseNumber(item.yearpublished?.["@_value"]),
        minPlayers: parseNumber(item.minplayers?.["@_value"]),
        maxPlayers: parseNumber(item.maxplayers?.["@_value"]),
        playingTime: parseNumber(item.playingtime?.["@_value"]),
        imageUrl: item.image ?? null,
      },
      bggData: {
        communityRating: parseNumber(ratings?.average?.["@_value"]) ?? 0,
        bayesAverage: parseNumber(ratings?.bayesaverage?.["@_value"]) ?? 0,
        weight,
        numWeightVotes: parseNumber(ratings?.numweights?.["@_value"]) ?? 0,
        description: item.description ?? null,
        mechanics: extractLinks(links, "boardgamemechanic"),
        categories: extractLinks(links, "boardgamecategory"),
        families: extractLinks(links, "boardgamefamily"),
        subdomains: extractLinks(links, "boardgamesubdomain"),
        suggestedPlayerCounts: extractSuggestedPlayerCounts(playerCountPoll),
        fetchedAt: new Date().toISOString(),
      },
    };
  });
}

export function parseSearchResponse(xml: string): BggSearchResult[] {
  const parsed = parser.parse(xml) as BggXmlDocument;
  assertBggXml(parsed, "search");
  const items = ensureArray(parsed?.items?.item);

  return items.map((item) => {
    const names = ensureArray(item.name);
    return {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber(item.yearpublished?.["@_value"]),
    };
  });
}

export function parseCollectionResponse(xml: string): BggCollectionItem[] {
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

    return {
      bggId: Number(item["@_objectid"]),
      name: nameStr,
      yearPublished: parseNumber(year),
      numplays: parseNumber(numplays),
    };
  });
}
