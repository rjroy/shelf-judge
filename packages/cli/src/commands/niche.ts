// Niche commands: ignored, ignore, unignore
import type { NicheSettings, NicheTagFilter } from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

const VALID_TYPES = new Set(["mechanic", "category", "family"]);

function validateType(type: string): asserts type is NicheTagFilter["type"] {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid tag type: "${type}". Must be one of: mechanic, category, family`);
  }
}

export async function nicheIgnored(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<NicheSettings>("/api/niches/settings");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load niche settings");
  }

  if (opts.json) return printOutput(data.ignoredTags, opts);

  if (data.ignoredTags.length === 0) {
    return "No ignored tags.";
  }

  return formatTable(
    ["Type", "Name"],
    data.ignoredTags.map((t) => [t.type, t.name]),
  );
}

export async function nicheIgnore(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const type = args[0];
  const name = args.slice(1).join(" ");

  if (!type || !name) {
    throw new Error("Usage: shelf-judge niche ignore <type> <name>");
  }

  validateType(type);

  const { ok, data } = await client.post<NicheSettings>("/api/niches/settings/ignore", {
    type,
    name,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to ignore tag");
  }

  if (opts.json) return printOutput(data, opts);

  return `Ignored ${type}: ${name}`;
}

export async function nicheUnignore(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const type = args[0];
  const name = args.slice(1).join(" ");

  if (!type || !name) {
    throw new Error("Usage: shelf-judge niche unignore <type> <name>");
  }

  validateType(type);

  const { ok, data } = await client.del<NicheSettings>("/api/niches/settings/ignore", {
    type,
    name,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to unignore tag");
  }

  if (opts.json) return printOutput(data, opts);

  return `Unignored ${type}: ${name}`;
}
