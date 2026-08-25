import { describe, expect, test } from "bun:test";
import { getDerivedFieldDiscovery } from "@shelf-judge/shared";
import {
  configurationDraftFromField,
  derivedCreateInput,
  nativeScaleFromDiscovery,
  readAxisFormError,
} from "@/lib/derived-axis-web";

describe("discovery-driven axis management", () => {
  const discovery = getDerivedFieldDiscovery();

  test("builds every derived template from discovery and permits duplicate payloads", () => {
    const payloads = discovery.fields.map((field) => {
      const draft = configurationDraftFromField(field);
      for (const property of field.configuration) {
        if (draft[property.name] === "") draft[property.name] = String(property.minimum);
      }
      return derivedCreateInput(field, draft);
    });

    expect(payloads).toHaveLength(discovery.fields.length);
    expect(payloads.map((payload) => payload.derivedField)).toEqual(
      discovery.fields.map((field) => field.id),
    );
    expect(
      derivedCreateInput(discovery.fields[0], configurationDraftFromField(discovery.fields[0])),
    ).toEqual(
      derivedCreateInput(discovery.fields[0], configurationDraftFromField(discovery.fields[0])),
    );
  });

  test("keeps a required configuration without a default empty and uses discovered bounds", () => {
    const field = discovery.fields.find((candidate) =>
      candidate.configuration.some(
        (property) => property.required && property.default === undefined,
      ),
    );
    if (!field) throw new Error("Expected a required configuration without a default");
    const property = field.configuration.find((candidate) => candidate.required);
    if (!property) throw new Error("Expected a required property");
    const draft = configurationDraftFromField(field);
    expect(draft[property.name]).toBe("");
    draft[property.name] = String(property.maximum);
    expect(derivedCreateInput(field, draft).configuration).toEqual({
      [property.name]: property.maximum,
    });
  });

  test("uses configuration-bound scale and numeric tolerance from discovery defaults", () => {
    const field = discovery.fields.find(
      (candidate) => candidate.nativeScaleDiscovery.type === "configuration-bound",
    );
    if (!field) throw new Error("Expected a configuration-bound native scale");
    const draft = configurationDraftFromField(field);
    expect(nativeScaleFromDiscovery(field, draft)).toEqual(field.nativeScale);
    expect(field.template.toleranceWidth).toBe(30);
    expect(derivedCreateInput(field, draft).toleranceWidth).toBe(30);
  });

  test("maps structured curve validation details to actionable fields and retains server message", async () => {
    const response = new Response(
      JSON.stringify({
        error: "Validation failed",
        message: "maximum is outside the allowed range",
        code: "invalid_curve_for_native_scale",
        details: [
          {
            field: "idealValue",
            path: ["idealValue"],
          },
          {
            field: "toleranceWidth",
            path: ["toleranceWidth"],
          },
          {
            field: "veto",
            path: ["veto", "threshold"],
          },
        ],
      }),
      { status: 400 },
    );
    const error = await readAxisFormError(response);
    expect(error.fields.idealValue).toContain("native scale");
    expect(error.fields.toleranceWidth).toContain("native scale");
    expect(error.fields["veto.threshold"]).toContain("native scale");
    expect(error.summary).toContain("maximum is outside the allowed range");
  });
});
