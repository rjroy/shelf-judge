import type { ZodType } from "zod";

export type OperationJsonValue =
  | null
  | boolean
  | number
  | string
  | OperationJsonValue[]
  | { [key: string]: OperationJsonValue };

export const UNSAFE_STORED_AMOUNT_SCHEMA: { [key: string]: OperationJsonValue } = {
  anyOf: [
    { pattern: "^0*[1-9]\\d{14,}(?:\\.\\d{1,2})?$" },
    {
      pattern:
        "^0*9(?:[1-9]\\d{12}|0[1-9]\\d{11}|00[8-9]\\d{10}|007[2-9]\\d{9}|007199[3-9]\\d{6}|0071992[6-9]\\d{5}|00719925[5-9]\\d{4}|007199254[8-9]\\d{3}|0071992547[5-9]\\d{2}|00719925474[1-9]\\d)(?:\\.\\d{1,2})?$",
    },
    { pattern: "^0*90071992547409\\.9[2-9]$" },
  ],
};

export interface OperationParameter {
  name: string;
  in: "path" | "query" | "body";
  description: string;
  required: boolean;
  acceptedValues?: string[];
}

export interface OperationErrorDefinition {
  status: number;
  code: string;
  description: string;
  response: { error: string; code: string; [key: string]: OperationJsonValue };
}

export interface OperationDefinition {
  operationId: string;
  name: string;
  description: string;
  invocation: { method: string; path: string };
  requestSchema?: ZodType;
  request?: { body: { [key: string]: OperationJsonValue } };
  hierarchy: { root: string; feature: string };
  parameters?: OperationParameter[];
  errors?: OperationErrorDefinition[];
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
  request?: { body: { [key: string]: OperationJsonValue } };
  errors?: OperationErrorDefinition[];
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
          request: op.request,
          errors: op.errors,
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
