import type { ZodType } from "zod";

export interface OperationParameter {
  name: string;
  in: "path" | "query" | "body";
  description: string;
  required: boolean;
}

export interface OperationDefinition {
  operationId: string;
  name: string;
  description: string;
  invocation: { method: string; path: string };
  requestSchema?: ZodType;
  hierarchy: { root: string; feature: string };
  parameters?: OperationParameter[];
  idempotent: boolean;
}

export interface RouteModule {
  routes: import("hono").Hono;
  operations: OperationDefinition[];
}

export interface OperationTreeNode {
  operationId?: string;
  name: string;
  description?: string;
  invocation?: { method: string; path: string };
  idempotent?: boolean;
  parameters?: OperationParameter[];
  children?: Record<string, OperationTreeNode>;
}

export function buildOperationTree(operations: OperationDefinition[]): OperationTreeNode {
  const root: OperationTreeNode = { name: "shelf", children: {} };

  for (const op of operations) {
    const parts = op.operationId.split(".");
    // parts[0] is root (shelf), parts[1] is feature, parts[2+] is operation name
    let current = root;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children) current.children = {};

      if (i === parts.length - 1) {
        // Leaf node: the operation itself
        current.children[part] = {
          operationId: op.operationId,
          name: op.name,
          description: op.description,
          invocation: op.invocation,
          idempotent: op.idempotent,
          parameters: op.parameters,
        };
      } else {
        // Intermediate node
        if (!current.children[part]) {
          current.children[part] = { name: part, children: {} };
        }
        current = current.children[part];
      }
    }
  }

  return root;
}

export function filterOperationsByFeature(
  operations: OperationDefinition[],
  feature: string,
): OperationDefinition[] {
  return operations.filter((op) => op.hierarchy.feature === feature);
}
