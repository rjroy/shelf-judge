// Profile command: outputs the collection profile as JSON.
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

export async function profileCommand(
  client: DaemonClient,
  _args: string[],
  _opts: OutputOptions,
): Promise<string> {
  const profile = await client.getProfile();
  return printOutput(profile, { json: true });
}
