import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/index.js";

describe("CLI derived-axis argument parsing", () => {
  test("parses template creation configuration and native tolerance", () => {
    const parsed = parseArgs([
      "bun",
      "shelf-judge",
      "axis",
      "create",
      "--template",
      "playerCountFit",
      "--target-player-count",
      "4",
      "--tolerance-width",
      "2",
      "Targeted Player Count",
    ]);

    expect(parsed).toMatchObject({
      commandPath: "axis create",
      positional: ["Targeted Player Count"],
      template: "playerCountFit",
      targetPlayerCount: 4,
      toleranceWidth: 2,
    });
  });

  test("parses repair cap and tolerance transition flags", () => {
    const parsed = parseArgs([
      "bun",
      "shelf-judge",
      "axis",
      "repair",
      "legacy-id",
      "--template",
      "playingTime",
      "--maximum-scoring-time",
      "300",
      "--no-tolerance",
      "--no-tolerance-width",
    ]);

    expect(parsed).toMatchObject({
      commandPath: "axis repair",
      positional: ["legacy-id"],
      template: "playingTime",
      maximumScoringTime: 300,
      noTolerance: true,
      noToleranceWidth: true,
    });
  });
});

describe("purchase utilization argument parsing", () => {
  const cases: Array<[string[], string, string[]]> = [
    [["game", "acquisition", "game/1", "unknown"], "game acquisition", ["game/1", "unknown"]],
    [["game", "acquisition", "game/1", "gift"], "game acquisition", ["game/1", "gift"]],
    [
      ["game", "acquisition", "game/1", "purchase", "0008.50", "--json"],
      "game acquisition",
      ["game/1", "purchase", "0008.50"],
    ],
    [["--json", "game", "value", "game/1"], "game value", ["game/1"]],
    [["collection", "benchmark", "get"], "collection benchmark", ["get"]],
    [
      ["collection", "benchmark", "set", "0008.50", "--json"],
      "collection benchmark",
      ["set", "0008.50"],
    ],
    [["collection", "benchmark", "clear"], "collection benchmark", ["clear"]],
  ];
  test.each(cases)(
    "keeps positional command values unchanged",
    (tokens, commandPath, positional) => {
      const parsed = parseArgs(["bun", "shelf-judge", ...tokens]);
      expect(parsed.commandPath).toBe(commandPath);
      expect(parsed.positional).toEqual(positional);
      expect(parsed.json).toBe(tokens.includes("--json"));
    },
  );

  test.each([
    [
      ["game", "acquisition", "game/1", "purchase", "--name"],
      "game acquisition",
      ["game/1", "purchase", "--name"],
    ],
    [["collection", "benchmark", "set", "--weight"], "collection benchmark", ["set", "--weight"]],
  ] as Array<[string[], string, string[]]>)(
    "preserves recognized flag-shaped amount strings",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
      });
    },
  );

  test.each([
    [
      ["game", "acquisition", "game/1", "gift", "--weight", "5"],
      "game acquisition",
      ["game/1", "gift", "--weight", "5"],
    ],
    [
      ["game", "value", "game/1", "--name", "ignored"],
      "game value",
      ["game/1", "--name", "ignored"],
    ],
    [
      ["collection", "benchmark", "get", "--description", "ignored", "--json"],
      "collection benchmark",
      ["get", "--description", "ignored"],
    ],
  ] as Array<[string[], string, string[]]>)(
    "preserves unrelated recognized options as actionable extra arguments",
    (tokens, commandPath, positional) => {
      const parsed = parseArgs(["bun", "shelf-judge", ...tokens]);
      expect(parsed.commandPath).toBe(commandPath);
      expect(parsed.positional).toEqual(positional);
      expect(parsed.json).toBe(tokens.includes("--json"));
    },
  );
});

describe("intention and play command parsing", () => {
  test.each([
    [
      ["game", "intention", "set", "game-1", "replay", "--command-id", "command-1"],
      "game intention set",
      ["game-1", "replay", "--command-id", "command-1"],
    ],
    [
      ["game", "intention", "complete", "game-1", "intention-1", "--expected-version", "2"],
      "game intention complete",
      ["game-1", "intention-1", "--expected-version", "2"],
    ],
    [
      ["game", "intention", "retire", "game-1", "intention-1", "--expected-version", "1"],
      "game intention retire",
      ["game-1", "intention-1", "--expected-version", "1"],
    ],
    [["game", "plays", "set", "game-1", "4", "--json"], "game plays set", ["game-1", "4"]],
  ] as Array<[string[], string, string[]]>)(
    "matches the three-token command without consuming local flags",
    (tokens, commandPath, args) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional: args,
        json: tokens.includes("--json"),
      });
    },
  );

  test("preserves unrelated recognized flags so command validation rejects them", () => {
    expect(
      parseArgs([
        "bun",
        "shelf-judge",
        "game",
        "intention",
        "set",
        "game-1",
        "first-play",
        "--name",
        "ignored",
      ]),
    ).toMatchObject({
      commandPath: "game intention set",
      positional: ["game-1", "first-play", "--name", "ignored"],
    });
  });
});

describe("owner-note command parsing", () => {
  test.each([
    [["game", "note", "get", "game-1", "--json"], "game note get", ["game-1"]],
    [
      [
        "game",
        "note",
        "set",
        "game-1",
        "--expected-version",
        "0",
        "--text",
        "first line\nsecond line",
      ],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "first line\nsecond line"],
    ],
    [
      ["game", "note", "clear", "game-1", "--expected-version", "2", "--command-id", "id"],
      "game note clear",
      ["game-1", "--expected-version", "2", "--command-id", "id"],
    ],
    [
      ["game", "note", "set", "game-1", "--expected-version", "0", "--text", "--json", "--json"],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "--json"],
    ],
    [
      ["game", "note", "set", "game-1", "--expected-version", "0", "--text", "--text", "--json"],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "--text"],
    ],
  ] as Array<[string[], string, string[]]>)(
    "keeps command-local note flags intact",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
        json: tokens.includes("--json"),
      });
    },
  );
});
