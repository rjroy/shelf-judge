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
