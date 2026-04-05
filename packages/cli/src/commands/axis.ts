// Axis commands: list, create, update, delete
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

interface AxisData {
  id: string;
  name: string;
  weight: number;
  source: string;
  description: string | null;
}

export async function axisList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<AxisData[]>("/api/axes");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "List failed");
  }

  if (opts.json) return printOutput(data, opts);

  const axes = data as AxisData[];
  return formatTable(
    ["ID", "Name", "Weight", "Source"],
    axes.map((a) => [a.id.slice(0, 8), a.name, String(a.weight), a.source]),
  );
}

export async function axisCreate(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { weight?: number; description?: string },
): Promise<string> {
  const name = args.join(" ");
  if (!name) {
    throw new Error("Usage: shelf-judge axis create <name> [--weight N] [--description TEXT]");
  }

  const body: Record<string, unknown> = { name };
  if (opts.weight !== undefined) body.weight = opts.weight;
  else body.weight = 50; // sensible default
  if (opts.description !== undefined) body.description = opts.description;

  const { ok, data } = await client.post<AxisData>("/api/axes", body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Create failed");
  }

  if (opts.json) return printOutput(data, opts);

  const axis = data as AxisData;
  return `Created axis: ${axis.name} (ID: ${axis.id}, weight: ${axis.weight})`;
}

export async function axisUpdate(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { weight?: number; name?: string; description?: string },
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error(
      "Usage: shelf-judge axis update <id> [--weight N] [--name NAME] [--description TEXT]",
    );
  }

  const body: Record<string, unknown> = {};
  if (opts.weight !== undefined) body.weight = opts.weight;
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;

  if (Object.keys(body).length === 0) {
    throw new Error("At least one of --weight, --name, or --description must be provided");
  }

  const { ok, data } = await client.put<AxisData>(`/api/axes/${encodeURIComponent(id)}`, body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Update failed");
  }

  if (opts.json) return printOutput(data, opts);

  const axis = data as AxisData;
  return `Updated axis: ${axis.name} (weight: ${axis.weight})`;
}

export async function axisDelete(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: shelf-judge axis delete <id>");
  }

  const { ok, data } = await client.del<{ deletedRatingsCount: number }>(
    `/api/axes/${encodeURIComponent(id)}`,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Delete failed");
  }

  if (opts.json) return printOutput(data, opts);

  const result = data as { deletedRatingsCount: number };
  return `Deleted axis. Removed ${result.deletedRatingsCount} rating(s) across games.`;
}
