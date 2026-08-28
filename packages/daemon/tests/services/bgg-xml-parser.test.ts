import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import {
  parseThingResponse,
  parseThingMetadata,
  parseThingItems,
  parseSearchResponse,
  parseCollectionResponse,
} from "../../src/services/bgg-xml-parser.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

function thingXmlWithPlayerPoll(results: string | null): string {
  const poll = results === null ? "" : `<poll name="suggested_numplayers">${results}</poll>`;
  return `<items><item type="boardgame" id="1">
    <name type="primary" value="Player Test"/>
    ${poll}
  </item></items>`;
}

function playerCountResult(playerCount: string, bestVotes: number): string {
  return `<results numplayers="${playerCount}">
    <result value="Best" numvotes="${bestVotes}"/>
    <result value="Recommended" numvotes="0"/>
    <result value="Not Recommended" numvotes="0"/>
  </results>`;
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

      // Subdomains
      expect(data.subdomains.length).toBe(2);
      const subNames = data.subdomains.map((s) => s.name);
      expect(subNames).toContain("Strategy Games");
      expect(subNames).toContain("Family Games");

      // Suggested player counts are carried only by the persistence sidecar.
      const poll = parseThingItems(xml)[0]?.suggestedPlayerPoll;
      expect(poll?.buckets.length).toBeGreaterThanOrEqual(5);
      const threePlayer = poll?.buckets.find((s) => s.playerCount === "3");
      expect(threePlayer).toBeDefined();
      expect(threePlayer!.best).toBe(1217);
      expect(threePlayer!.recommended).toBe(596);
      expect(threePlayer!.notRecommended).toBe(25);
      expect(data.bestPlayerCount).toBe(3);

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

    test("selects the numeric player count with the highest positive Best vote count", () => {
      const xml = thingXmlWithPlayerPoll(
        playerCountResult("2", 4) + playerCountResult("3", 12) + playerCountResult("4", 8),
      );

      expect(parseThingResponse(xml)[0]?.bestPlayerCount).toBe(3);
    });

    test("returns null when the suggested-player-count poll is absent", () => {
      expect(parseThingResponse(thingXmlWithPlayerPoll(null))[0]?.bestPlayerCount).toBeNull();
    });

    test("returns null when every Best vote count is zero", () => {
      const xml = thingXmlWithPlayerPoll(playerCountResult("2", 0) + playerCountResult("3", 0));

      expect(parseThingResponse(xml)[0]?.bestPlayerCount).toBeNull();
    });

    test("keeps the first numeric bucket when Best vote counts tie", () => {
      const xml = thingXmlWithPlayerPoll(playerCountResult("2", 10) + playerCountResult("3", 10));

      expect(parseThingResponse(xml)[0]?.bestPlayerCount).toBe(2);
    });

    test("uses an aggregate bucket's numeric lower bound when it has the most Best votes", () => {
      const xml = thingXmlWithPlayerPoll(playerCountResult("4", 10) + playerCountResult("5+", 100));

      expect(parseThingResponse(xml)[0]?.bestPlayerCount).toBe(5);
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
      expect(m.thumbnailUrl).toContain("geekdo-images.com");
      expect(m).not.toHaveProperty("minPlayingTime");
      expect(m).not.toHaveProperty("maxPlayingTime");
      expect(m).not.toHaveProperty("minPlayTime");
      expect(m).not.toHaveProperty("maxPlayTime");
      expect(m).not.toHaveProperty("minPlaytime");
      expect(m).not.toHaveProperty("maxPlaytime");
      expect(m).not.toHaveProperty("minplaytime");
      expect(m).not.toHaveProperty("maxplaytime");
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

      // Search results have no thumbnails (BGG search endpoint doesn't include them)
      for (const result of results) {
        expect(result.thumbnailUrl).toBeNull();
      }
    });

    test("handles empty search results", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?><items total="0"></items>`;
      const results = parseSearchResponse(xml);
      expect(results).toHaveLength(0);
    });
  });

  describe("parseThingItems", () => {
    test("parses complete entity classes with deterministic validation and deduplication", async () => {
      const observedAt = "2026-08-28T10:00:00.000Z";
      const items = parseThingItems(await readFixture("thing-entity-links.xml"), observedAt);

      expect(items[0]?.entityMetadata).toEqual({
        mechanic: {
          state: "complete",
          entities: [],
          observedAt,
          refreshFailure: null,
          correctionDestination: null,
        },
        designer: {
          state: "complete",
          entities: [],
          observedAt,
          refreshFailure: null,
          correctionDestination: null,
        },
        artist: {
          state: "complete",
          entities: [],
          observedAt,
          refreshFailure: null,
          correctionDestination: null,
        },
      });
      expect(items[1]?.entityMetadata).toMatchObject({
        mechanic: { entities: [{ id: 101, name: "Drafting" }] },
        designer: { entities: [{ id: 201, name: "Designer One" }] },
        artist: { entities: [{ id: 301, name: "Artist One" }] },
      });
      expect(items[2]?.entityMetadata).toMatchObject({
        mechanic: {
          entities: [
            { id: 101, name: "Alpha Drafting" },
            { id: 102, name: "Worker Placement" },
          ],
        },
        designer: {
          entities: [
            { id: 202, name: "Designer Two" },
            { id: 203, name: "Designer Three" },
          ],
        },
        artist: {
          entities: [
            { id: 302, name: "Artist Two" },
            { id: 303, name: "Artist Three" },
          ],
        },
      });
      expect(items[2]?.bggData.mechanics).toEqual(items[2]?.entityMetadata.mechanic.entities);
      expect(items[3]?.entityMetadata).toMatchObject({
        mechanic: { entities: [] },
        designer: { entities: [] },
        artist: { entities: [{ id: 304, name: "Artist Four" }] },
      });
      for (const item of items) {
        expect(
          new Set(Object.values(item.entityMetadata).map((metadata) => metadata.observedAt)),
        ).toEqual(new Set([observedAt]));
      }
    });

    test("distinguishes absent, empty, unusable, and usable suggested-player polls", () => {
      const cases = [
        { xml: thingXmlWithPlayerPoll(null), state: "absent" },
        { xml: thingXmlWithPlayerPoll(""), state: "empty" },
        {
          xml: thingXmlWithPlayerPoll(
            '<results><result value="Unexpected" numvotes="4"/></results>',
          ),
          state: "unusable",
        },
        { xml: thingXmlWithPlayerPoll(playerCountResult("5+", 7)), state: "usable" },
      ] as const;

      for (const { xml, state } of cases) {
        expect(parseThingItems(xml, "2026-08-26T10:00:00.000Z")[0]?.suggestedPlayerPoll.state).toBe(
          state,
        );
      }
    });

    test("retains factual buckets once while preserving best-player compatibility", () => {
      const xml = thingXmlWithPlayerPoll(
        `<results numplayers="Crowd">
          <result value="Best" numvotes="7"/>
          <result value="Recommended" numvotes="5"/>
          <result value="Not Recommended" numvotes="3"/>
        </results>${playerCountResult("5+", 11)}`,
      );
      const observedAt = "2026-08-26T10:00:00.000Z";
      const item = parseThingItems(xml, observedAt)[0];
      const compatibility = parseThingResponse(xml, observedAt)[0];

      expect(item?.suggestedPlayerPoll.buckets).toEqual([
        { playerCount: "Crowd", best: 7, recommended: 5, notRecommended: 3 },
        { playerCount: "5+", best: 11, recommended: 0, notRecommended: 0 },
      ]);
      expect(compatibility?.bestPlayerCount).toBe(5);
      expect(compatibility).not.toHaveProperty("suggestedPlayerCounts");
      expect(compatibility).not.toHaveProperty("suggestedPlayerPoll");
      expect(item?.suggestedPlayerPoll.observation?.observedAt).toBe(observedAt);
    });

    test("rejects unsafe compatibility labels without discarding the factual bucket", () => {
      const unsafe = "9007199254740992";
      const item = parseThingItems(thingXmlWithPlayerPoll(playerCountResult(unsafe, 7)))[0];

      expect(item?.bggData.bestPlayerCount).toBeNull();
      expect(item?.suggestedPlayerPoll.buckets).toEqual([
        { playerCount: unsafe, best: 7, recommended: 0, notRecommended: 0 },
      ]);
    });

    test("rejects non-positive and noninteger compatibility labels", () => {
      for (const playerCount of ["0", "-1", "1.5"]) {
        const item = parseThingItems(thingXmlWithPlayerPoll(playerCountResult(playerCount, 7)))[0];

        expect(item?.bggData.bestPlayerCount).toBeNull();
      }
    });

    test("uses one thing observation for metadata, range, poll, and fetchedAt", () => {
      const observedAt = "2026-08-26T11:00:00.000Z";
      const item = parseThingItems(
        thingXmlWithPlayerPoll(playerCountResult("2", 4)),
        observedAt,
      )[0];

      expect(item?.metadataObservation.observedAt).toBe(observedAt);
      expect(item?.playerRangeObservation.observedAt).toBe(observedAt);
      expect(item?.suggestedPlayerPoll.observation?.observedAt).toBe(observedAt);
      expect(item?.bggData.fetchedAt).toBe(observedAt);
    });

    test("derives partial thing evidence from fields actually present", () => {
      const observedAt = "2026-08-26T11:30:00.000Z";
      const xml = `<items><item type="boardgame" id="1">
        <minplayers value="2"/>
      </item></items>`;

      const item = parseThingItems(xml, observedAt)[0];

      expect(item?.metadataObservation).toEqual({
        sourceRequest: "bgg-thing",
        observedAt,
        state: "partial",
        fieldsReturned: ["minPlayers"],
      });
      expect(item?.metadata.name).toBe("Unknown");
      expect(item?.playerRangeObservation).toEqual({
        sourceRequest: "bgg-thing",
        observedAt,
        state: "partial",
        fieldsReturned: ["minPlayers"],
      });
      expect(item?.suggestedPlayerPoll.state).toBe("absent");
      expect(item?.bggData.communityRating).toBe(0);
      expect(item?.bggData.numWeightVotes).toBe(0);
    });

    test("reports malformed-present player bounds without changing compatibility values", () => {
      const observedAt = "2026-08-26T11:40:00.000Z";
      const xml = `<items><item type="boardgame" id="1">
        <minplayers value="many"/>
        <maxplayers value="several"/>
      </item></items>`;

      const item = parseThingItems(xml, observedAt)[0];

      expect(item?.metadata.minPlayers).toBeNull();
      expect(item?.metadata.maxPlayers).toBeNull();
      expect(item?.playerRangeObservation).toEqual({
        sourceRequest: "bgg-thing",
        observedAt,
        state: "complete",
        fieldsReturned: ["minPlayers", "maxPlayers"],
      });
      expect(item?.metadataObservation.fieldsReturned).toEqual(["minPlayers", "maxPlayers"]);
      expect(item?.metadataObservation.state).toBe("partial");
    });

    test("reports empty-present player bounds without changing compatibility values", () => {
      const observedAt = "2026-08-26T11:41:00.000Z";
      const xml = `<items><item type="boardgame" id="1">
        <minplayers/>
        <maxplayers/>
      </item></items>`;

      const item = parseThingItems(xml, observedAt)[0];

      expect(item?.metadata.minPlayers).toBeNull();
      expect(item?.metadata.maxPlayers).toBeNull();
      expect(item?.playerRangeObservation).toEqual({
        sourceRequest: "bgg-thing",
        observedAt,
        state: "complete",
        fieldsReturned: ["minPlayers", "maxPlayers"],
      });
      expect(item?.metadataObservation.fieldsReturned).toEqual(["minPlayers", "maxPlayers"]);
      expect(item?.metadataObservation.state).toBe("partial");
    });

    test("reports fully absent player bounds separately from present empty bounds", () => {
      const observedAt = "2026-08-26T11:42:00.000Z";
      const xml = `<items><item type="boardgame" id="1"></item></items>`;

      const item = parseThingItems(xml, observedAt)[0];

      expect(item?.metadata.minPlayers).toBeNull();
      expect(item?.metadata.maxPlayers).toBeNull();
      expect(item?.playerRangeObservation).toEqual({
        sourceRequest: "bgg-thing",
        observedAt,
        state: "absent",
        fieldsReturned: [],
      });
      expect(item?.metadataObservation.fieldsReturned).toEqual([]);
      expect(item?.metadataObservation.state).toBe("absent");
    });

    test("does not report compatibility BGG defaults as no-statistics evidence", async () => {
      const xml = await readFixture("thing-search-batch.xml");
      const items = parseThingItems(xml, "2026-08-26T11:45:00.000Z");

      for (const item of items) {
        expect(item.metadataObservation.state).toBe("partial");
        expect(item.metadataObservation.fieldsReturned).not.toContain("bggData");
        expect(item.bggData.communityRating).toBe(0);
        expect(item.bggData.bayesAverage).toBe(0);
      }
    });

    test("selects aggregate player-count buckets through the production batch path", () => {
      const xml = thingXmlWithPlayerPoll(
        playerCountResult("4", 10) + playerCountResult("5+", 100) + playerCountResult("6", 100),
      );

      expect(parseThingItems(xml)[0]?.bggData.bestPlayerCount).toBe(5);
    });

    test("extracts thumbnailUrl from batch thing response", async () => {
      const xml = await readFixture("thing-search-batch.xml");
      const items = parseThingItems(xml);

      expect(items).toHaveLength(3);

      // First two items have thumbnails
      const wingspan = items.find((i) => i.bggId === 266192);
      expect(wingspan).toBeDefined();
      expect(wingspan!.metadata.thumbnailUrl).toContain("geekdo-images.com");

      const frogmouth = items.find((i) => i.bggId === 339017);
      expect(frogmouth).toBeDefined();
      expect(frogmouth!.metadata.thumbnailUrl).toContain("frogmouth");

      // Third item has no thumbnail
      const asia = items.find((i) => i.bggId === 366161);
      expect(asia).toBeDefined();
      expect(asia!.metadata.thumbnailUrl).toBeNull();
    });

    test("retains player bounds and singular playing time without duration ranges", async () => {
      const xml = await readFixture("thing-wingspan-266192.xml");
      const [item] = parseThingItems(xml);

      expect(item.metadata.minPlayers).toBe(1);
      expect(item.metadata.maxPlayers).toBe(5);
      expect(item.metadata.playingTime).toBe(70);
      expect(item.metadata).not.toHaveProperty("minPlayingTime");
      expect(item.metadata).not.toHaveProperty("maxPlayingTime");
      expect(item.metadata).not.toHaveProperty("minPlayTime");
      expect(item.metadata).not.toHaveProperty("maxPlayTime");
      expect(item.metadata).not.toHaveProperty("minPlaytime");
      expect(item.metadata).not.toHaveProperty("maxPlaytime");
      expect(item.metadata).not.toHaveProperty("minplaytime");
      expect(item.metadata).not.toHaveProperty("maxplaytime");
    });
  });

  describe("parseCollectionResponse", () => {
    test("attaches the producing collection observation to play counts", () => {
      const observedAt = "2026-08-26T12:00:00.000Z";
      const xml = `<items><item objectid="1"><name>Test</name><numplays>4</numplays></item></items>`;

      const item = parseCollectionResponse(xml, observedAt)[0];

      expect(item?.playCountObservation).toEqual({
        sourceRequest: "bgg-collection",
        observedAt,
        state: "complete",
        fieldsReturned: ["numPlays"],
      });
    });

    test("distinguishes malformed-present and absent collection play counts", () => {
      const observedAt = "2026-08-26T12:05:00.000Z";
      const xml = `<items>
        <item objectid="1"><name>Malformed</name><numplays>many</numplays></item>
        <item objectid="2"><name>Absent</name></item>
      </items>`;

      const [malformed, absent] = parseCollectionResponse(xml, observedAt);

      expect(malformed.numplays).toBeNull();
      expect(malformed.playCountObservation).toEqual({
        sourceRequest: "bgg-collection",
        observedAt,
        state: "complete",
        fieldsReturned: ["numPlays"],
      });
      expect(absent.numplays).toBeNull();
      expect(absent.playCountObservation).toEqual({
        sourceRequest: "bgg-collection",
        observedAt,
        state: "absent",
        fieldsReturned: [],
      });
    });

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
