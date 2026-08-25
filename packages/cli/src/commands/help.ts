// Help command: discovers operations from daemon
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

interface OperationTreeNode {
  operationId?: string;
  name: string;
  description?: string;
  invocation?: { method: string; path: string };
  children?: Record<string, OperationTreeNode>;
}

interface LocalCommandHelp {
  name: string;
  usage: string;
  description: string;
}

// One API operation can intentionally back multiple CLI commands. Keep those
// CLI-only aliases here instead of advertising duplicate daemon operations.
const LOCAL_OPERATION_COMMANDS: Record<string, LocalCommandHelp[]> = {
  "shelf.axis.create": [
    {
      name: "create",
      usage:
        "shelf-judge axis create [name] [--template <template-id>] [--target-player-count <count>] [--maximum-scoring-time <minutes>]",
      description: "Create a personal axis or a registry-backed derived template",
    },
  ],
  "shelf.axis.update": [
    {
      name: "update",
      usage:
        "shelf-judge axis update <axis-id> [--target-player-count <count>] [--maximum-scoring-time <minutes>]",
      description: "Update axis settings, including derived configuration",
    },
  ],
  "shelf.axis.derived-fields": [
    {
      name: "templates",
      usage: "shelf-judge axis templates [--json]",
      description: "List registry-backed derived axis templates",
    },
  ],
  "shelf.axis.repair": [
    {
      name: "repair",
      usage:
        "shelf-judge axis repair <axis-id> --template <template-id> [--target-player-count <count>] [--maximum-scoring-time <minutes>]",
      description: "Repair a disabled legacy axis while retaining its ratings and overrides",
    },
  ],
  "shelf.game.shelf-assignment": [
    {
      name: "assign-shelf",
      usage: "shelf-judge game assign-shelf <game-id> <shelf-id>",
      description: "Assign an owned, measured game to a shelf",
    },
    {
      name: "clear-shelf",
      usage: "shelf-judge game clear-shelf <game-id>",
      description: "Clear a game's manual shelf assignment and return it to automatic placement",
    },
  ],
};

export async function helpCommand(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const feature = args[0];
  const path = feature ? `/api/help/${encodeURIComponent(feature)}` : "/api/help";

  const { ok, data } = await client.get<OperationTreeNode>(path);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Help failed");
  }

  if (opts.json) return printOutput(data, opts);

  const lines: string[] = [];
  lines.push("shelf-judge - Board game fitness scoring");
  lines.push("");
  formatNode(data, lines, 0);
  return lines.join("\n");
}

function formatNode(node: OperationTreeNode, lines: string[], depth: number): void {
  if (node.operationId) {
    const indent = "  ".repeat(depth);
    const method = node.invocation?.method ?? "";
    const localCommands = LOCAL_OPERATION_COMMANDS[node.operationId];
    if (localCommands) {
      for (const command of localCommands) {
        lines.push(`${indent}${command.name} - ${command.description} [${method}]`);
        lines.push(`${indent}  Usage: ${command.usage}`);
      }
      if (node.description) lines.push(`${indent}  ${node.description}`);
    } else {
      lines.push(`${indent}${node.name} - ${node.description ?? ""} [${method}]`);
    }
  }

  if (node.children) {
    for (const [key, child] of Object.entries(node.children)) {
      if (!child.operationId && child.children) {
        // Feature group
        const indent = "  ".repeat(depth);
        lines.push(`${indent}${key}:`);
        formatNode(child, lines, depth + 1);
      } else {
        formatNode(child, lines, depth);
      }
    }
  }
}
