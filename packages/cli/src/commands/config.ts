// Config commands: get, set
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

interface ConfigData {
  bggAuthToken: string | null;
  groundedAnalysis: {
    providerId: string;
    modelId: string;
    extensionIds: string[];
  } | null;
}

export async function configGet(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<ConfigData>("/api/config");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Config get failed");
  }

  if (opts.json) return printOutput(data, opts);

  const groundedAnalysis = data.groundedAnalysis;
  return formatTable(
    ["Key", "Value"],
    [
      ["bgg-token", data.bggAuthToken ?? "(not set)"],
      ["grounded-analysis", groundedAnalysis ? "configured (restart daemon to apply changes)" : "(not set)"],
      ["grounded-analysis.provider", groundedAnalysis?.providerId ?? "(not set)"],
      ["grounded-analysis.model", groundedAnalysis?.modelId ?? "(not set)"],
      ["grounded-analysis.extensions", groundedAnalysis?.extensionIds.join(", ") || "(none)"],
    ],
  );
}

export async function configSet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const key = args[0];
  const value = args.slice(1).join(" ");

  if (!key || !value) {
    throw new Error("Usage: shelf-judge config set <key> <value>");
  }

  const bodyMap: Record<string, Record<string, unknown>> = {
    "bgg-token": { bggAuthToken: value },
  };
  if (key === "grounded-analysis") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
        throw new Error("must be an identity object or null");
      }
      bodyMap[key] = { groundedAnalysis: parsed };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`Invalid grounded-analysis JSON: ${detail}`);
    }
  }

  const body = bodyMap[key];
  if (!body) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(bodyMap).join(", ")}`);
  }

  const { ok, data } = await client.put<ConfigData>("/api/config", body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Config set failed");
  }

  if (opts.json) return printOutput(data, opts);

  return `Updated ${key}${key === "grounded-analysis" ? "; restart the daemon to apply changes" : ""}`;
}
