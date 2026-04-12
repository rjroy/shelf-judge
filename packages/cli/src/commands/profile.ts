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

export async function profileNarrateCommand(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const res = await client.generateNarration();
  if (res.status === 503) {
    // SDK not configured; return the algorithmic profile without narration
    const profile = await client.getProfile();
    console.error("LLM narration unavailable: set ANTHROPIC_API_KEY to enable");
    return printOutput(profile, { ...opts, json: true });
  }
  if (!res.ok) {
    const errorData = res.data as { error?: string };
    throw new Error(errorData.error ?? `Narration failed: ${res.status}`);
  }
  return printOutput(res.data, { ...opts, json: true });
}
