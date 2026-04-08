import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import {
  parseThingResponse,
  parseThingMetadata,
  parseSearchResponse,
  parseCollectionResponse,
} from "../../src/services/bgg-xml-parser.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

describe("BGG XML Parser", () => {
  describe("parseThingResponse", () => {
    test("parses Wingspan thing response with all fields", async () => {
      const xml = await readFixture("thing-wingspan-266192.xml");
      const results = parseThingResponse(xml);

      expect(results).toHaveLength(1);
      const data = results[0];

      expect(data.communityRating).toBeCloseTo(8.00153);
      expect(data.bayesAverage).toBeCloseTo(7.8487);
      expect(data.weight).toBeCloseTo(2.4802);
      expect(data.numWeightVotes).toBe(3711);

      // Mechanics
      expect(data.mechanics.length).toBeGreaterThanOrEqual(4);
      const mechNames = data.mechanics.map((m) => m.name);
      expect(mechNames).toContain("Hand Management");
      expect(mechNames).toContain("Set Collection");

      // Categories
      expect(data.categories.length).toBeGreaterThanOrEqual(1);
      const catNames = data.categories.map((c) => c.name);
      expect(catNames).toContain("Animals");
      expect(catNames).toContain("Card Game");

      // Suggested player counts
      expect(data.suggestedPlayerCounts.length).toBeGreaterThanOrEqual(5);
      const threePlayer = data.suggestedPlayerCounts.find((s) => s.playerCount === "3");
      expect(threePlayer).toBeDefined();
      expect(threePlayer!.best).toBe(1217);
      expect(threePlayer!.recommended).toBe(596);
      expect(threePlayer!.notRecommended).toBe(25);

      // fetchedAt should be a valid ISO string
      expect(new Date(data.fetchedAt).getTime()).not.toBeNaN();
    });

    test("parses Gloomhaven thing response", async () => {
      const xml = await readFixture("thing-gloomhaven-174430.xml");
      const results = parseThingResponse(xml);

      expect(results).toHaveLength(1);
      const data = results[0];

      expect(data.communityRating).toBeCloseTo(8.54142);
      expect(data.bayesAverage).toBeCloseTo(8.29996);
      expect(data.weight).toBeCloseTo(3.9179);
      expect(data.numWeightVotes).toBe(2752);

      const mechNames = data.mechanics.map((m) => m.name);
      expect(mechNames).toContain("Cooperative Game");
      expect(mechNames).toContain("Hand Management");

      const catNames = data.categories.map((c) => c.name);
      expect(catNames).toContain("Adventure");
      expect(catNames).toContain("Fantasy");
    });

    test("treats averageweight of 0 as null", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<items><item type="boardgame" id="99999">
  <name type="primary" sortindex="1" value="Zero Weight Game"/>
  <statistics page="1"><ratings>
    <average value="7.0"/>
    <bayesaverage value="6.5"/>
    <numweights value="0"/>
    <averageweight value="0"/>
    <median value="0"/>
  </ratings></statistics>
</item></items>`;
      const results = parseThingResponse(xml);
      expect(results[0].weight).toBeNull();
    });

    test("extracts primary name when multiple name elements exist", async () => {
      const xml = await readFixture("thing-wingspan-266192.xml");
      const metadata = parseThingMetadata(xml);

      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe("Wingspan");
    });
  });

  describe("parseThingMetadata", () => {
    test("extracts game metadata from Wingspan", async () => {
      const xml = await readFixture("thing-wingspan-266192.xml");
      const metadata = parseThingMetadata(xml);

      expect(metadata).toHaveLength(1);
      const m = metadata[0];

      expect(m.bggId).toBe(266192);
      expect(m.name).toBe("Wingspan");
      expect(m.yearPublished).toBe(2019);
      expect(m.minPlayers).toBe(1);
      expect(m.maxPlayers).toBe(5);
      expect(m.playingTime).toBe(70);
      expect(m.imageUrl).toContain("geekdo-images.com");
    });

    test("extracts Gloomhaven metadata", async () => {
      const xml = await readFixture("thing-gloomhaven-174430.xml");
      const metadata = parseThingMetadata(xml);

      expect(metadata[0].bggId).toBe(174430);
      expect(metadata[0].name).toBe("Gloomhaven");
      expect(metadata[0].yearPublished).toBe(2017);
      expect(metadata[0].minPlayers).toBe(1);
      expect(metadata[0].maxPlayers).toBe(4);
      expect(metadata[0].playingTime).toBe(120);
    });
  });

  describe("parseSearchResponse", () => {
    test("parses search results with IDs, names, and years", async () => {
      const xml = await readFixture("search-wingspan.xml");
      const results = parseSearchResponse(xml);

      expect(results).toHaveLength(14);
      expect(results[0].bggId).toBe(339017);
      expect(results[0].name).toBe("Frogmouth Fan Pack (fan expansion for Wingspan)");
      expect(results[0].yearPublished).toBe(2020);
      expect(results[1].bggId).toBe(266192);
      expect(results[1].name).toBe("Wingspan");
    });

    test("handles empty search results", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?><items total="0"></items>`;
      const results = parseSearchResponse(xml);
      expect(results).toHaveLength(0);
    });
  });

  describe("parseCollectionResponse", () => {
    test("parses collection with game list", async () => {
      const xml = await readFixture("collection-bloodmage.xml");
      const results = parseCollectionResponse(xml);

      expect(results).toHaveLength(316);
      expect(results[0].bggId).toBe(373167);
      expect(results[0].name).toBe("20 Strong");
      expect(results[0].yearPublished).toBe(2023);
      expect(results[1].bggId).toBe(357726);
      expect(results[1].name).toBe("51st State: Ultimate Edition");
      expect(results[2].bggId).toBe(344872);
      expect(results[2].name).toBe("À la Food Cart");
    });

    test("handles empty collection", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?><items totalitems="0"></items>`;
      const results = parseCollectionResponse(xml);
      expect(results).toHaveLength(0);
    });
  });
});
