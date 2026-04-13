// Shelf configuration commands: list, add-unit, add-shelf, remove-unit, remove-shelf
import type { ShelfConfiguration, ShelfUnit } from "@shelf-judge/shared";
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
