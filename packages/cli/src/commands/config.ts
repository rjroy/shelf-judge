// Config commands: get, set
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

interface ConfigData {
  bggAuthToken: string | null;
  dataDir: string;
  socketPath: string;
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

  return formatTable(
    ["Key", "Value"],
    [
      ["bgg-token", data.bggAuthToken ?? "(not set)"],
      ["data-dir", data.dataDir],
      ["socket-path", data.socketPath],
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
    "socket-path": { socketPath: value },
  };

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

  return `Updated ${key}`;
}
