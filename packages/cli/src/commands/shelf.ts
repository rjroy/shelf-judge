// Shelf configuration commands: list, add-unit, add-shelf, remove-unit, remove-shelf,
// status (summary), capacity (detailed per-shelf + overflow).
import type { ShelfCapacityResult, ShelfConfiguration, ShelfUnit } from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

function formatShelfConfig(config: ShelfConfiguration): string {
  if (config.units.length === 0) {
    return "No shelf units configured. Use `shelf-judge shelf add-unit <name>` to create one.";
  }

  const lines: string[] = [];

  for (const unit of config.units) {
    lines.push(`\n${unit.name} (${unit.id})`);
    if (unit.shelves.length === 0) {
      lines.push("  (no shelves)");
    } else {
      const rows = unit.shelves.map((s) => [
        s.id,
        s.name,
        String(s.width),
        s.height === null ? "---" : String(s.height),
        String(s.depth),
        s.height === null
          ? "unconstrained"
          : `${(s.width * s.height * s.depth).toLocaleString()} in\u00B3`,
      ]);
      lines.push(
        formatTable(["ID", "Name", "Width", "Height", "Depth", "Volume"], rows)
          .split("\n")
          .map((l) => "  " + l)
          .join("\n"),
      );
    }
  }

  return lines.join("\n");
}

export async function shelfList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<ShelfConfiguration>("/api/shelf/config");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load shelf configuration");
  }

  if (opts.json) return printOutput(data, opts);

  return formatShelfConfig(data);
}

export async function shelfAddUnit(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const name = args[0];

  if (!name) {
    throw new Error("Usage: shelf-judge shelf add-unit <name>");
  }

  const { ok, data } = await client.post<ShelfUnit>("/api/shelf/units", {
    name,
    shelves: [],
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to add shelf unit");
  }

  if (opts.json) return printOutput(data, opts);

  return `Added shelf unit "${data.name}" (${data.id})`;
}

export async function shelfAddShelf(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  // args: <unit-id> <name> <width> <height> <depth>
  if (args.length < 5) {
    throw new Error(
      "Usage: shelf-judge shelf add-shelf <unit-id> <name> <width> <height> <depth>\n" +
        "       Use height=0 for unconstrained height.",
    );
  }

  const [unitId, name, widthStr, heightStr, depthStr] = args;
  const width = Number(widthStr);
  const rawHeight = Number(heightStr);
  const depth = Number(depthStr);

  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Width must be a positive number");
  }
  if (!Number.isFinite(rawHeight) || rawHeight < 0) {
    throw new Error("Height must be a non-negative number (0 for unconstrained)");
  }
  if (!Number.isFinite(depth) || depth <= 0) {
    throw new Error("Depth must be a positive number");
  }

  // REQ-SHELF-33: height=0 maps to null (unconstrained)
  const height = rawHeight === 0 ? null : rawHeight;

  // Load current unit to get existing shelves
  const configRes = await client.get<ShelfConfiguration>("/api/shelf/config");
  if (!configRes.ok) {
    throw new Error("Failed to load shelf configuration");
  }

  const unit = configRes.data.units.find((u) => u.id === unitId);
  if (!unit) {
    throw new Error(`Shelf unit not found: ${unitId}`);
  }

  const newShelves = [
    ...unit.shelves.map((s) => ({
      id: s.id,
      name: s.name,
      width: s.width,
      height: s.height,
      depth: s.depth,
    })),
    { name, width, height, depth },
  ];

  const { ok, data } = await client.put<ShelfUnit>(`/api/shelf/units/${unitId}`, {
    shelves: newShelves,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to add shelf");
  }

  if (opts.json) return printOutput(data, opts);

  const heightDisplay = height === null ? "unconstrained" : `${height}`;
  return `Added shelf "${name}" (${width} \u00D7 ${heightDisplay} \u00D7 ${depth} in) to "${data.name}"`;
}

export async function shelfRemoveUnit(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const unitId = args[0];

  if (!unitId) {
    throw new Error("Usage: shelf-judge shelf remove-unit <unit-id>");
  }

  const { ok, data } = await client.del<{ removed: true }>(`/api/shelf/units/${unitId}`);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to remove shelf unit");
  }

  if (opts.json) return printOutput(data, opts);

  return `Removed shelf unit ${unitId}`;
}

export async function shelfRemoveShelf(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const shelfId = args[0];

  if (!shelfId) {
    throw new Error("Usage: shelf-judge shelf remove-shelf <shelf-id>");
  }

  // Load config to find which unit contains this shelf
  const configRes = await client.get<ShelfConfiguration>("/api/shelf/config");
  if (!configRes.ok) {
    throw new Error("Failed to load shelf configuration");
  }

  let targetUnit: ShelfUnit | undefined;
  for (const unit of configRes.data.units) {
    if (unit.shelves.some((s) => s.id === shelfId)) {
      targetUnit = unit;
      break;
    }
  }

  if (!targetUnit) {
    throw new Error(`Shelf not found: ${shelfId}`);
  }

  const newShelves = targetUnit.shelves
    .filter((s) => s.id !== shelfId)
    .map((s) => ({ id: s.id, name: s.name, width: s.width, height: s.height, depth: s.depth }));

  const { ok, data } = await client.put<ShelfUnit>(`/api/shelf/units/${targetUnit.id}`, {
    shelves: newShelves,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to remove shelf");
  }

  if (opts.json) return printOutput(data, opts);

  return `Removed shelf ${shelfId} from "${data.name}"`;
}

function countPlacedGames(capacity: ShelfCapacityResult): number {
  let placed = 0;
  for (const assignment of capacity.assignments) {
    placed += assignment.games.length;
  }
  return placed;
}

function countUnconstrainedShelves(config: ShelfConfiguration): number {
  let count = 0;
  for (const unit of config.units) {
    for (const shelf of unit.shelves) {
      if (shelf.height === null) count++;
    }
  }
  return count;
}

function formatUtilization(assignment: ShelfCapacityResult["assignments"][number]): string {
  if (assignment.utilization === null) return "unconstrained";
  return `${Math.round(assignment.utilization * 100)}%`;
}

// REQ-SHELF-34: compact summary of shelves, measured games, and packing outcomes.
export async function shelfStatus(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [configRes, capacityRes] = await Promise.all([
    client.get<ShelfConfiguration>("/api/shelf/config"),
    client.get<ShelfCapacityResult>("/api/shelf/capacity"),
  ]);

  if (!configRes.ok) {
    const err = configRes.data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load shelf configuration");
  }
  if (!capacityRes.ok) {
    const err = capacityRes.data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load shelf capacity");
  }

  const config = configRes.data;
  const capacity = capacityRes.data;

  if (opts.json) {
    return printOutput({ config, capacity }, opts);
  }

  if (!capacity.configured || capacity.totalShelfCount === 0) {
    return "Shelf Configuration: no shelves configured. Use `shelf-judge shelf add-unit <name>` to start.";
  }

  const unitCount = config.units.length;
  const shelfCount = capacity.totalShelfCount;
  const unconstrained = countUnconstrainedShelves(config);
  const unconstrainedNote = unconstrained > 0 ? ` (${unconstrained} unconstrained-height)` : "";

  const measured = capacity.gamesWithDimensions;
  const totalGames = measured + capacity.gamesWithoutDimensions;

  const placed = countPlacedGames(capacity);
  const unfittable = capacity.unfittableGames.length;
  const displaced = capacity.overflowGames.length;

  const lines: string[] = [];
  lines.push(
    `Shelf Configuration: ${unitCount} ${unitCount === 1 ? "unit" : "units"}, ${shelfCount} ${shelfCount === 1 ? "shelf" : "shelves"}${unconstrainedNote}`,
  );
  lines.push(`Games Measured: ${measured} of ${totalGames}`);

  if (measured === 0) {
    lines.push("Placed: none (no games have box dimensions yet)");
    return lines.join("\n");
  }

  lines.push(
    `Placed: ${placed} ${placed === 1 ? "game" : "games"} across ${shelfCount} ${shelfCount === 1 ? "shelf" : "shelves"}`,
  );

  if (unfittable === 0 && displaced === 0) {
    lines.push("All measured games placed successfully.");
  } else {
    lines.push(`Unfittable: ${unfittable}${unfittable > 0 ? " (don't fit any shelf)" : ""}`);
    lines.push(`Displaced: ${displaced}${displaced > 0 ? " (fit by shape but no room)" : ""}`);
  }

  return lines.join("\n");
}

// REQ-SHELF-35: detailed three-section output — per-shelf assignments,
// unfittable games, displaced games. --json returns the raw ShelfCapacityResult.
export async function shelfCapacity(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<ShelfCapacityResult>("/api/shelf/capacity");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load shelf capacity");
  }

  if (opts.json) return printOutput(data, opts);

  const capacity = data;

  if (!capacity.configured || capacity.totalShelfCount === 0) {
    return "No shelves configured. Use `shelf-judge shelf add-unit <name>` to start.";
  }

  if (capacity.gamesWithDimensions === 0) {
    return "Shelves configured, but no games have box dimensions yet. Use `shelf-judge game edit <id> --box-width --box-height --box-depth` to add them.";
  }

  const sections: string[] = [];

  // Section 1: Per-shelf assignments
  const assignRows = capacity.assignments.map((a) => [
    a.shelfName,
    `${a.unitName}`,
    String(a.games.length),
    formatUtilization(a),
    a.grade.toUpperCase(),
  ]);
  sections.push(
    [
      `Shelf Assignments (${capacity.totalShelfCount} ${capacity.totalShelfCount === 1 ? "shelf" : "shelves"}, ${countPlacedGames(capacity)} placed)`,
      formatTable(["Shelf", "Unit", "Games", "Utilization", "Grade"], assignRows),
    ].join("\n"),
  );

  // Section 2: Unfittable games
  if (capacity.unfittableGames.length > 0) {
    const rows = capacity.unfittableGames.map((entry) => [
      entry.gameName,
      entry.fitnessScore.toFixed(1),
      `${entry.boxDimensions.width}\u00D7${entry.boxDimensions.height}\u00D7${entry.boxDimensions.depth} in`,
      entry.reason,
    ]);
    sections.push(
      [
        `Unfittable Games (${capacity.unfittableGames.length} \u2014 don't fit any shelf)`,
        formatTable(["Game", "Fitness", "Dimensions", "Reason"], rows),
      ].join("\n"),
    );
  }

  // Section 3: Displaced games
  if (capacity.overflowGames.length > 0) {
    const rows = capacity.overflowGames.map((entry) => [
      entry.gameName,
      entry.fitnessScore.toFixed(1),
      `${Math.round(entry.volumeIn3).toLocaleString()} in\u00B3`,
    ]);
    sections.push(
      [
        `Displaced Games (${capacity.overflowGames.length} \u2014 fit by shape but no room)`,
        formatTable(["Game", "Fitness", "Volume"], rows),
      ].join("\n"),
    );
  }

  if (capacity.gamesWithoutDimensions > 0) {
    sections.push(
      `Note: ${capacity.gamesWithoutDimensions} ${capacity.gamesWithoutDimensions === 1 ? "game has" : "games have"} no box dimensions and ${capacity.gamesWithoutDimensions === 1 ? "is" : "are"} excluded.`,
    );
  }

  return sections.join("\n\n");
}
