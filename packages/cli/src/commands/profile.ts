// Profile command: outputs the collection profile as JSON.
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

export async function profileCommand(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const profile = await client.getProfile();
  // Profile is complex nested data; always render as JSON regardless of opts.json.
  return printOutput(profile, { ...opts, json: true });
}
