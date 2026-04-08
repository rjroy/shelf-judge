import { describe, test, expect, beforeEach } from "bun:test";
import * as path from "node:path";
import { createGameService } from "../../src/services/game-service.js";
import { createFitnessService } from "../../src/services/fitness-service.js";
import { createStorageService } from "../../src/services/storage-service.js";
import { createBggClient } from "../../src/services/bgg-client.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";
import { createMockFetch } from "../helpers/mock-fetch.js";
import type { GameService, ImportProgressEvent } from "../../src/services/game-service.js";
import type { StorageService } from "../../src/services/storage-service.js";
import type { BggClient } from "../../src/services/bgg-client.js";
import type { MockFileOps } from "../helpers/mock-file-ops.js";

const fixturesDir = path.join(import.meta.dir, "../fixtures");

async function readFixture(filename: string): Promise<string> {
  return Bun.file(path.join(fixturesDir, filename)).text();
}

let fileOps: MockFileOps;
let storageService: StorageService;
let gameService: GameService;
let bggClient: BggClient;
let mockFetch: ReturnType<typeof createMockFetch>;

beforeEach(() => {
  fileOps = createMockFileOps();
  storageService = createStorageService({
    dataDir: "/data",
    configPath: "/config/config.json",
    fileOps,
  });
  mockFetch = createMockFetch();
  bggClient = createBggClient({
    config: { bggAuthToken: "test-token", username: "testuser" },
    fetchFn: mockFetch.fn,
    delayMs: 0,
    delayFn: () => Promise.resolve(),
  });
  const fitnessService = createFitnessService();
  gameService = createGameService({ storageService, fitnessService, bggClient });
});

describe("Collection Import", () => {
  test("imports all games from BGG collection", async () => {
    const collectionXml = await readFixture("collection-testuser.xml");

    // Collection fetch
    mockFetch.enqueue(200, collectionXml);

    // Batch thing request for all 3 games
    // Build a combined response
    const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="266192">
    <name type="primary" sortindex="1" value="Wingspan"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="70"/>
    <image>https://example.com/wingspan.jpg</image>
    <statistics page="1"><ratings>
      <average value="8.1"/>
      <bayesaverage value="7.92"/>
      <numweights value="12000"/>
      <averageweight value="2.45"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="174430">
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <yearpublished value="2017"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <image>https://example.com/gloomhaven.jpg</image>
    <statistics page="1"><ratings>
      <average value="8.62"/>
      <bayesaverage value="8.48"/>
      <numweights value="15000"/>
      <averageweight value="3.86"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="167791">
    <name type="primary" sortindex="1" value="Terraforming Mars"/>
    <yearpublished value="2016"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="120"/>
    <image>https://example.com/tm.jpg</image>
    <statistics page="1"><ratings>
      <average value="8.38"/>
      <bayesaverage value="8.19"/>
      <numweights value="10000"/>
      <averageweight value="3.26"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
</items>`;
    mockFetch.enqueue(200, batchXml);

    const summary = await gameService.importBggCollection();

    expect(summary.imported).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(0);

    const games = await gameService.listGames();
    expect(games).toHaveLength(3);
  });

  test("skips games that already exist (matched by bggId)", async () => {
    // Pre-add Wingspan
    const wingspanThingXml = await readFixture("thing-wingspan-266192.xml");
    const collectionWingspanXml = await readFixture("collection-testuser-wingspan-266192.xml");
    mockFetch.enqueue(200, wingspanThingXml);
    mockFetch.enqueue(200, collectionWingspanXml);
    await gameService.addGame({ name: "Wingspan", bggId: 266192 });

    const collectionXml = await readFixture("collection-testuser.xml");
    mockFetch.enqueue(200, collectionXml);

    // Batch fetch for the 2 new games (Gloomhaven + Terraforming Mars)
    const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="174430">
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <yearpublished value="2017"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <statistics page="1"><ratings>
      <average value="8.62"/>
      <bayesaverage value="8.48"/>
      <numweights value="15000"/>
      <averageweight value="3.86"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="167791">
    <name type="primary" sortindex="1" value="Terraforming Mars"/>
    <yearpublished value="2016"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="120"/>
    <statistics page="1"><ratings>
      <average value="8.38"/>
      <bayesaverage value="8.19"/>
      <numweights value="10000"/>
      <averageweight value="3.26"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
</items>`;
    mockFetch.enqueue(200, batchXml);

    const summary = await gameService.importBggCollection();

    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBe(1); // Wingspan skipped
    expect(summary.errors).toHaveLength(0);
  });

  test("reports progress during import", async () => {
    const collectionXml = await readFixture("collection-testuser.xml");
    mockFetch.enqueue(200, collectionXml);

    const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="266192">
    <name type="primary" sortindex="1" value="Wingspan"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="70"/>
    <statistics page="1"><ratings>
      <average value="8.1"/>
      <bayesaverage value="7.92"/>
      <numweights value="12000"/>
      <averageweight value="2.45"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="174430">
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <yearpublished value="2017"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <statistics page="1"><ratings>
      <average value="8.62"/>
      <bayesaverage value="8.48"/>
      <numweights value="15000"/>
      <averageweight value="3.86"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="167791">
    <name type="primary" sortindex="1" value="Terraforming Mars"/>
    <yearpublished value="2016"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="120"/>
    <statistics page="1"><ratings>
      <average value="8.38"/>
      <bayesaverage value="8.19"/>
      <numweights value="10000"/>
      <averageweight value="3.26"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
</items>`;
    mockFetch.enqueue(200, batchXml);

    const events: ImportProgressEvent[] = [];
    await gameService.importBggCollection((event) => {
      events.push(event);
    });

    // Should have a fetching-collection event plus importing events
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].phase).toBe("fetching-collection");

    const importEvents = events.filter((e) => e.phase === "importing-games");
    // 1 "signal total" event + 3 per-game events
    expect(importEvents.length).toBe(4);
    // First event signals the total before batch fetch
    expect(importEvents[0].importedSoFar).toBe(0);
    expect(importEvents[0].total).toBe(3);
    // Subsequent counts should increment
    expect(importEvents[1].current).toBeLessThanOrEqual(importEvents[2].current);
  });

  test("handles partial failure (some games fail to fetch)", async () => {
    const collectionXml = await readFixture("collection-testuser.xml");
    mockFetch.enqueue(200, collectionXml);

    // Batch response missing Terraforming Mars (167791)
    const batchXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="266192">
    <name type="primary" sortindex="1" value="Wingspan"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="70"/>
    <statistics page="1"><ratings>
      <average value="8.1"/>
      <bayesaverage value="7.92"/>
      <numweights value="12000"/>
      <averageweight value="2.45"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
  <item type="boardgame" id="174430">
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <yearpublished value="2017"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <playingtime value="120"/>
    <statistics page="1"><ratings>
      <average value="8.62"/>
      <bayesaverage value="8.48"/>
      <numweights value="15000"/>
      <averageweight value="3.86"/>
      <median value="0"/>
    </ratings></statistics>
  </item>
</items>`;
    mockFetch.enqueue(200, batchXml);

    const summary = await gameService.importBggCollection();

    expect(summary.imported).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("Terraforming Mars");
  });

  test("handles empty collection", async () => {
    const emptyXml = `<?xml version="1.0" encoding="utf-8"?><items totalitems="0"></items>`;
    mockFetch.enqueue(200, emptyXml);

    const summary = await gameService.importBggCollection();

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });

  test("throws when BGG not configured", async () => {
    const noBggService = createGameService({
      storageService,
      fitnessService: createFitnessService(),
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(noBggService.importBggCollection()).rejects.toThrow(
      "BGG integration is not configured",
    );
  });
});
