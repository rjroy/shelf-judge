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
  "shelf.game.intention.set": [
    {
      name: "intention set",
      usage: "shelf-judge game intention set <game-id> <first-play|replay> [--command-id <uuid>]",
      description: "Create an explicit eligible play intention",
    },
  ],
  "shelf.game.intention.complete": [
    {
      name: "intention complete",
      usage:
        "shelf-judge game intention complete <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]",
      description: "Complete an intention from personal knowledge without changing play count",
    },
  ],
  "shelf.game.intention.retire": [
    {
      name: "intention retire",
      usage:
        "shelf-judge game intention retire <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]",
      description: "Retire an intention that is no longer active",
    },
  ],
  "shelf.game.plays.set": [
    {
      name: "plays set",
      usage: "shelf-judge game plays set <game-id> <count>",
      description: "Correct recorded play evidence and report any automatic completion",
    },
  ],
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
  "shelf.game.set-acquisition": [
    {
      name: "acquisition",
      usage: "shelf-judge game acquisition <game-id> unknown|gift|purchase [amount] [--json]",
      description:
        "Set or correct unknown, gift, or purchase acquisition; purchase amount is lifetime landed cost",
    },
  ],
  "shelf.game.get": [
    {
      name: "value",
      usage: "shelf-judge game value <game-id> [--json]",
      description: "Show daemon-calculated purchase utilization using predicted detail fitness",
    },
  ],
  "shelf.collection.get-entertainment-benchmark": [
    {
      name: "benchmark get",
      usage: "shelf-judge collection benchmark get [--json]",
      description: "Show the collection entertainment benchmark or its unknown/invalid state",
    },
  ],
  "shelf.collection.set-entertainment-benchmark": [
    {
      name: "benchmark set",
      usage: "shelf-judge collection benchmark set <amount> [--json]",
      description: "Set or correct the positive acceptable cost per person-hour at fitness 6",
    },
  ],
  "shelf.collection.clear-entertainment-benchmark": [
    {
      name: "benchmark clear",
      usage: "shelf-judge collection benchmark clear [--json]",
      description: "Clear the benchmark to unknown; clearing is distinct from setting an amount",
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
  lines.push("");
  lines.push("Purchase utilization amounts use one implicit personal currency.");
  lines.push(
    "Amounts use unsigned decimal strings: one or more whole-number digits, optionally followed by a decimal point and one or two digits. Signs, leading-dot forms, and trailing decimal points are invalid. Purchase zero is a known zero-cost purchase, distinct from gift or unknown.",
  );
  lines.push(
    "Purchase amount means cumulative lifetime landed cost, including the game and costs required to acquire it; set corrects the saved amount, while unknown or clear removes it from calculation.",
  );
  lines.push(
    "The entertainment benchmark is a positive acceptable cost per person-hour at fitness 6. Example: $16 / 2 hours = $8 per person-hour.",
  );
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
