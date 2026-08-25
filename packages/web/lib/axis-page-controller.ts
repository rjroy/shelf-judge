import type { Axis, DerivedFieldDiscovery } from "@shelf-judge/shared";
import { curveStateToBody, type CurveState } from "@/lib/axis-curve-state";
import { configurationFromDraft, type ConfigurationDraft } from "@/lib/derived-axis-web";

export type AxisFormScope = "create" | `update:${string}` | `repair:${string}`;

export class AxisFormRequestTracker {
  readonly #versions = new Map<AxisFormScope, number>();

  begin(scope: AxisFormScope): number {
    const version = (this.#versions.get(scope) ?? 0) + 1;
    this.#versions.set(scope, version);
    return version;
  }

  isCurrent(scope: AxisFormScope, version: number): boolean {
    return this.#versions.get(scope) === version;
  }
}

export interface CreateAxisInput {
  name: string;
  description: string;
  weight: string;
  curve: CurveState;
  derivedField: DerivedFieldDiscovery | null;
  configuration: ConfigurationDraft;
}

export function buildCreateAxisBody({
  name,
  description,
  weight,
  curve,
  derivedField,
  configuration,
}: CreateAxisInput): Record<string, unknown> {
  return {
    source: derivedField ? "derived" : "personal",
    name: name.trim(),
    description: description.trim() || undefined,
    weight: parseInt(weight, 10),
    ...curveStateToBody(curve, "create"),
    ...(derivedField
      ? {
          derivedField: derivedField.id,
          configuration: configurationFromDraft(derivedField, configuration),
        }
      : {}),
  };
}

export function createAxis(
  input: CreateAxisInput,
  request: typeof fetch = fetch,
): Promise<Response> {
  return request("/api/daemon/axes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCreateAxisBody(input)),
  });
}

export interface UpdateAxisInput {
  axis: Axis;
  name: string;
  description: string;
  weight: string;
  curve: CurveState;
  derivedField?: DerivedFieldDiscovery;
  configuration: ConfigurationDraft;
}

export function buildUpdateAxisBody({
  axis,
  name,
  description,
  weight,
  curve,
  derivedField,
  configuration,
}: UpdateAxisInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (axis.source === "tournament") {
    if (weight) body.weight = parseInt(weight, 10);
    return body;
  }

  if (name.trim() && name.trim() !== axis.name) body.name = name.trim();
  if (weight) body.weight = parseInt(weight, 10);
  if (description !== axis.description) body.description = description;
  Object.assign(body, curveStateToBody(curve, "update"));
  if (axis.source === "derived") {
    if (!derivedField) throw new Error("Derived field metadata is unavailable");
    body.configuration = configurationFromDraft(derivedField, configuration);
  }
  return body;
}

export function updateAxis(
  id: string,
  input: UpdateAxisInput,
  request: typeof fetch = fetch,
): Promise<Response> {
  return request(`/api/daemon/axes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildUpdateAxisBody(input)),
  });
}

export function buildRepairAxisBody(
  field: DerivedFieldDiscovery,
  configuration: ConfigurationDraft,
  curve: CurveState,
): Record<string, unknown> {
  return {
    derivedField: field.id,
    configuration: configurationFromDraft(field, configuration),
    ...curveStateToBody(curve, "update"),
  };
}

export function repairAxis(
  id: string,
  field: DerivedFieldDiscovery,
  configuration: ConfigurationDraft,
  curve: CurveState,
  request: typeof fetch = fetch,
): Promise<Response> {
  return request(`/api/daemon/axes/${id}/repair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRepairAxisBody(field, configuration, curve)),
  });
}

export function deleteAxis(id: string, request: typeof fetch = fetch): Promise<Response> {
  return request(`/api/daemon/axes/${id}`, { method: "DELETE" });
}
