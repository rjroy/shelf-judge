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

export async function helpCommand(client: DaemonClient, args: string[], opts: OutputOptions): Promise<string> {
  const feature = args[0];
  const path = feature ? `/api/help/${encodeURIComponent(feature)}` : "/api/help";

  const { ok, data } = await client.get<OperationTreeNode>(path);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Help failed");
  }

  if (opts.json) return printOutput(data, opts);

  const tree = data as OperationTreeNode;
  const lines: string[] = [];
  lines.push("shelf-judge - Board game fitness scoring");
  lines.push("");
  formatNode(tree, lines, 0);
  return lines.join("\n");
}

function formatNode(node: OperationTreeNode, lines: string[], depth: number): void {
  if (node.operationId) {
    const indent = "  ".repeat(depth);
    const method = node.invocation?.method ?? "";
    lines.push(`${indent}${node.name} - ${node.description ?? ""} [${method}]`);
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
