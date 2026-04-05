import { XMLParser } from "fast-xml-parser";
import type { BggGameData, BggTag, SuggestedPlayerCount } from "@shelf-judge/shared";

export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
}

export interface BggCollectionItem {
  bggId: number;
  name: string;
  yearPublished: number | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["item", "link", "name", "results", "result", "rank"].includes(name),
});

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

function extractPrimaryName(names: Array<Record<string, string>>): string {
  const primary = names.find((n) => n["@_type"] === "primary");
  return primary?.["@_value"] ?? names[0]?.["@_value"] ?? "Unknown";
}

function extractLinks(links: Array<Record<string, string>>, type: string): BggTag[] {
  return links
    .filter((l) => l["@_type"] === type)
    .map((l) => ({
      id: Number(l["@_id"]),
      name: l["@_value"],
    }));
}

function extractSubdomains(links: Array<Record<string, string>>): string[] {
  return links.filter((l) => l["@_type"] === "boardgamesubdomain").map((l) => l["@_value"]);
}

function extractSuggestedPlayerCounts(
  poll: Record<string, unknown> | undefined,
): SuggestedPlayerCount[] {
  if (!poll) return [];
  const allResults = ensureArray(poll["results"] as Record<string, unknown>[] | undefined);
  return allResults.map((r) => {
    const playerCount = String(r["@_numplayers"] ?? "?");
    const votes = ensureArray(r["result"] as Array<Record<string, string>> | undefined);
    const best = Number(votes.find((v) => v["@_value"] === "Best")?.["@_numvotes"]) || 0;
    const recommended =
      Number(votes.find((v) => v["@_value"] === "Recommended")?.["@_numvotes"]) || 0;
    const notRecommended =
      Number(votes.find((v) => v["@_value"] === "Not Recommended")?.["@_numvotes"]) || 0;
    return { playerCount, best, recommended, notRecommended };
  });
}

export function parseThingResponse(xml: string): BggGameData[] {
  const parsed = parser.parse(xml);
  const items = ensureArray(parsed?.items?.item);

  return items.map((item: Record<string, unknown>) => {
    const names = ensureArray(item["name"] as Array<Record<string, string>>);
    const links = ensureArray(item["link"] as Array<Record<string, string>>);
    const stats = item["statistics"] as Record<string, unknown> | undefined;
    const ratings = stats?.["ratings"] as Record<string, unknown> | undefined;

    const avgWeight = parseNumber(
      (ratings?.["averageweight"] as Record<string, string>)?.["@_value"],
    );

    // BGG quirk: averageweight of 0 treated as null (known bug)
    const weight = avgWeight === 0 ? null : avgWeight;

    const polls = ensureArray(item["poll"] as Array<Record<string, unknown>> | undefined);
    const playerCountPoll = polls.find((p) => p["@_name"] === "suggested_numplayers");

    return {
      communityRating:
        parseNumber((ratings?.["average"] as Record<string, string>)?.["@_value"]) ?? 0,
      bayesAverage:
        parseNumber((ratings?.["bayesaverage"] as Record<string, string>)?.["@_value"]) ?? 0,
      weight,
      numWeightVotes:
        parseNumber((ratings?.["numweights"] as Record<string, string>)?.["@_value"]) ?? 0,
      mechanics: extractLinks(links, "boardgamemechanic"),
      categories: extractLinks(links, "boardgamecategory"),
      subdomains: extractSubdomains(links),
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

export function parseThingMetadata(xml: string): ThingMetadata[] {
  const parsed = parser.parse(xml);
  const items = ensureArray(parsed?.items?.item);

  return items.map((item: Record<string, unknown>) => {
    const names = ensureArray(item["name"] as Array<Record<string, string>>);
    return {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber((item["yearpublished"] as Record<string, string>)?.["@_value"]),
      minPlayers: parseNumber((item["minplayers"] as Record<string, string>)?.["@_value"]),
      maxPlayers: parseNumber((item["maxplayers"] as Record<string, string>)?.["@_value"]),
      playingTime: parseNumber((item["playingtime"] as Record<string, string>)?.["@_value"]),
      imageUrl: (item["image"] as string) ?? null,
    };
  });
}

export function parseSearchResponse(xml: string): BggSearchResult[] {
  const parsed = parser.parse(xml);
  const items = ensureArray(parsed?.items?.item);

  return items.map((item: Record<string, unknown>) => {
    const names = ensureArray(item["name"] as Array<Record<string, string>>);
    return {
      bggId: Number(item["@_id"]),
      name: extractPrimaryName(names),
      yearPublished: parseNumber((item["yearpublished"] as Record<string, string>)?.["@_value"]),
    };
  });
}

export function parseCollectionResponse(xml: string): BggCollectionItem[] {
  const parsed = parser.parse(xml);
  const items = ensureArray(parsed?.items?.item);

  return items.map((item: Record<string, unknown>) => {
    const nameRaw = item["name"];
    let nameStr: string;
    if (Array.isArray(nameRaw)) {
      // isArray config wraps <name> in an array; extract #text from first element
      const first = nameRaw[0];
      nameStr =
        typeof first === "string"
          ? first
          : ((first as Record<string, string>)?.["#text"] ?? "Unknown");
    } else if (typeof nameRaw === "string" || typeof nameRaw === "number") {
      nameStr = String(nameRaw);
    } else {
      nameStr = (nameRaw as Record<string, string>)?.["#text"] ?? "Unknown";
    }
    const year = item["yearpublished"] as number | string | undefined;

    return {
      bggId: Number(item["@_objectid"]),
      name: nameStr,
      yearPublished: parseNumber(year),
    };
  });
}
