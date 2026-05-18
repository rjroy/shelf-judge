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
  preferenceShape?: string;
  idealValue?: number | null;
  tolerance?: string;
  leanDirection?: string | null;
  veto?: { direction: "below" | "above"; threshold: number } | null;
}

function formatShapeColumn(axis: AxisData): string {
  const shape = axis.preferenceShape ?? "higher-is-better";
  let label: string;
  if (shape === "higher-is-better") {
    label = "linear\u2191";
  } else if (shape === "lower-is-better") {
    label = "linear\u2193";
  } else {
    const ideal = axis.idealValue != null ? axis.idealValue : "?";
    label = `sweet@${ideal}`;
  }
  if (axis.veto) {
    label += " V";
  }
  return label;
}

export interface CurveOptions {
  shape?: string;
  ideal?: number;
  tolerance?: string;
  lean?: string;
  vetoBelow?: number;
  vetoAbove?: number;
  noVeto?: boolean;
}

function buildCurveBody(opts: CurveOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.shape !== undefined) body.preferenceShape = opts.shape;
  if (opts.ideal !== undefined) body.idealValue = opts.ideal;
  if (opts.tolerance !== undefined) body.tolerance = opts.tolerance;
  if (opts.lean !== undefined) {
    body.leanDirection = opts.lean === "none" ? null : opts.lean;
  }
  if (opts.noVeto) {
    body.veto = null;
  } else if (opts.vetoBelow !== undefined) {
    body.veto = { direction: "below", threshold: opts.vetoBelow };
  } else if (opts.vetoAbove !== undefined) {
    body.veto = { direction: "above", threshold: opts.vetoAbove };
  }
  return body;
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

  return formatTable(
    ["ID", "Name", "Weight", "Source", "Shape"],
    data.map((a) => [a.id.slice(0, 8), a.name, String(a.weight), a.source, formatShapeColumn(a)]),
  );
}

export async function axisCreate(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { weight?: number; description?: string } & CurveOptions,
): Promise<string> {
  const name = args.join(" ");
  if (!name) {
    throw new Error("Usage: shelf-judge axis create <name> [--weight N] [--description TEXT]");
  }

  const body: Record<string, unknown> = { name, ...buildCurveBody(opts) };
  if (opts.weight !== undefined) body.weight = opts.weight;
  else body.weight = 50; // sensible default
  if (opts.description !== undefined) body.description = opts.description;

  const { ok, data } = await client.post<AxisData>("/api/axes", body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Create failed");
  }

  if (opts.json) return printOutput(data, opts);

  return `Created axis: ${data.name} (ID: ${data.id}, weight: ${data.weight})`;
}

export async function axisUpdate(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { weight?: number; name?: string; description?: string } & CurveOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error(
      "Usage: shelf-judge axis update <id> [--weight N] [--name NAME] [--description TEXT]",
    );
  }

  const curveBody = buildCurveBody(opts);
  const body: Record<string, unknown> = { ...curveBody };
  if (opts.weight !== undefined) body.weight = opts.weight;
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;

  if (Object.keys(body).length === 0) {
    throw new Error("At least one option must be provided");
  }

  const { ok, data } = await client.put<AxisData>(`/api/axes/${encodeURIComponent(id)}`, body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Update failed");
  }

  if (opts.json) return printOutput(data, opts);

  return `Updated axis: ${data.name} (weight: ${data.weight})`;
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

  const result = data;
  return `Deleted axis. Removed ${result.deletedRatingsCount} rating(s) across games.`;
}
