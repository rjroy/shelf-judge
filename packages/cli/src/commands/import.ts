// Import commands: bgg-collection
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

interface ImportProgress {
  imported: number;
  total: number;
  current: string;
}

interface ImportComplete {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importBggCollection(client: DaemonClient, args: string[], opts: OutputOptions): Promise<string> {
  const username = args[0];
  if (!username) {
    throw new Error("Usage: shelf-judge import bgg-collection <username>");
  }

  let result: ImportComplete | null = null;
  const progressLines: string[] = [];

  await client.postSSE("/api/import/bgg", { username }, (event) => {
    if (event.event === "progress") {
      const progress = JSON.parse(event.data) as ImportProgress;
      if (!opts.json) {
        const line = `Importing ${progress.imported}/${progress.total}: ${progress.current}`;
        // Overwrite current line in terminal for live progress
        process.stderr.write(`\r${line}${"".padEnd(20)}`);
      }
      progressLines.push(event.data);
    } else if (event.event === "complete") {
      result = JSON.parse(event.data) as ImportComplete;
    }
  });

  if (!opts.json && progressLines.length > 0) {
    // Clear the progress line
    process.stderr.write("\r" + "".padEnd(80) + "\r");
  }

  if (!result) {
    throw new Error("Import stream ended without a completion event. The daemon may have disconnected. Check that the daemon is still running with: shelf-judge help");
  }

  const summary = result as ImportComplete;

  if (opts.json) return printOutput(summary, opts);

  const lines: string[] = [];
  lines.push(`Import complete: ${summary.imported} imported, ${summary.skipped} skipped`);
  if (summary.errors.length > 0) {
    lines.push(`Errors (${summary.errors.length}):`);
    for (const err of summary.errors) {
      lines.push(`  - ${err}`);
    }
  }
  return lines.join("\n");
}
