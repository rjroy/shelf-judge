import { describe, test, expect } from "bun:test";
import { daemonStop } from "../../src/commands/daemon.js";
import { createMockClient } from "../helpers/mock-client.js";

describe("daemon stop", () => {
  test("reports not running when daemon unreachable", async () => {
    const client = createMockClient({ reachable: false });
    const result = await daemonStop(client, [], { json: false });
    expect(result).toContain("not running");
  });

  test("--json outputs parseable JSON when not running", async () => {
    const client = createMockClient({ reachable: false });
    const result = await daemonStop(client, [], { json: true });
    const parsed = JSON.parse(result);
    expect(parsed.stopped).toBe(false);
  });
});
