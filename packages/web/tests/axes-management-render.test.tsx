import { afterEach, describe, expect, mock, test } from "bun:test";
import { getDerivedFieldDiscovery, type Axis, type DisabledLegacyAxis } from "@shelf-judge/shared";
import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AxisCard, confirmVetoEnablement, CurveConfig, LegacyAxisCard } from "@/app/axes/page";
import { configurationDraftFromField } from "@/lib/derived-axis-web";
import { curveStateFromAxis, type CurveState } from "@/lib/axis-curve-state";

const field = getDerivedFieldDiscovery().fields.find(
  (candidate) => candidate.nativeScaleDiscovery.type === "configuration-bound",
);
if (!field) throw new Error("Expected a configuration-bound discovered field");

const derivedAxis: Axis = {
  id: "derived-axis",
  name: field.template.name,
  description: field.template.description,
  enabled: true,
  source: "derived",
  derivedField: "playingTime",
  configuration: { maximumScoringTime: 240 },
  weight: field.template.weight,
  preferenceShape: "sweet-spot",
  idealValue: 90,
  toleranceWidth: 30,
  veto: { direction: "above", threshold: 180 },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const legacyAxis: DisabledLegacyAxis = {
  id: "legacy-axis",
  name: "Legacy duration",
  description: null,
  enabled: false,
  source: "legacy",
  reason: "Historical field needs repair",
  legacyField: "duration",
  legacyPayload: {},
  weight: 50,
  preferenceShape: "sweet-spot",
  idealValue: 90,
  toleranceWidth: 30,
  veto: { direction: "above", threshold: 180 },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const errors = {
  idealValue: "Ideal must fit the configured range.",
  toleranceWidth: "Tolerance must fit the configured range.",
  "veto.threshold": "Veto must fit the configured range.",
};
const originalConfirm = globalThis.confirm;

afterEach(() => {
  globalThis.confirm = originalConfirm;
});

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return "";
}

function descendants(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    if (Array.isArray(node)) return node.flatMap(descendants);
    return [];
  }
  return [node, ...descendants(node.props.children)];
}

describe("axis management rendered workflows", () => {
  test("renders actionable curve errors and discovered native units", () => {
    const curve: CurveState = curveStateFromAxis(derivedAxis);
    const html = renderToStaticMarkup(
      <CurveConfig
        idPrefix="test-curve"
        curve={curve}
        onChange={() => undefined}
        scale={{ min: 1, max: 240 }}
        unit={field.unit}
        errors={errors}
      />,
    );

    expect(html).toContain(errors.idealValue);
    expect(html).toContain(errors.toleranceWidth);
    expect(html).toContain(errors["veto.threshold"]);
    expect(html).toContain(`Veto threshold (${field.unit})`);
    expect(html).toContain(`this value (${field.unit}) will get fitness 0`);
    expect(html).toContain('id="test-curve-ideal-value"');
    expect(html).toContain('aria-describedby="test-curve-ideal-value-error"');
    expect(html).toContain('id="test-curve-tolerance-width"');
    expect(html).toContain('aria-describedby="test-curve-tolerance-width-error"');
    expect(html).toContain('id="test-curve-veto-threshold"');
    expect(html).toContain('aria-describedby="test-curve-veto-threshold-error"');
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
  });

  test("threads field errors through the derived update form and invokes Save", () => {
    const onSave = mock(() => undefined);
    const curve = curveStateFromAxis(derivedAxis);
    const props: Parameters<typeof AxisCard>[0] = {
      axis: derivedAxis,
      editingId: derivedAxis.id,
      editName: derivedAxis.name,
      editWeight: String(derivedAxis.weight),
      editDescription: derivedAxis.description ?? "",
      editCurve: curve,
      totalWeight: derivedAxis.weight,
      ratingsCount: 1,
      onStartEdit: () => undefined,
      onCancelEdit: () => undefined,
      onSave,
      onDelete: () => undefined,
      onCurveChange: () => undefined,
      onNameChange: () => undefined,
      onWeightChange: () => undefined,
      onDescChange: () => undefined,
      discoveryField: field,
      editConfiguration: configurationDraftFromField(field, derivedAxis.configuration),
      formError: { summary: "Update rejected.", fields: errors },
      onConfigurationChange: () => undefined,
    };
    const card = AxisCard(props);
    const html = renderToStaticMarkup(card);

    expect(html).toContain(errors.idealValue);
    expect(html).toContain(errors.toleranceWidth);
    expect(html).toContain(errors["veto.threshold"]);
    const save = descendants(card).find((element) => text(element) === "Save");
    if (!save) throw new Error("Expected Save action");
    (save.props as { onClick: () => void }).onClick();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("renders persisted ideal and veto values with the discovered native unit", () => {
    const html = renderToStaticMarkup(
      <AxisCard
        axis={derivedAxis}
        editingId={null}
        editName=""
        editWeight=""
        editDescription=""
        editCurve={curveStateFromAxis(derivedAxis)}
        totalWeight={derivedAxis.weight}
        ratingsCount={0}
        onStartEdit={() => undefined}
        onCancelEdit={() => undefined}
        onSave={() => undefined}
        onDelete={() => undefined}
        onCurveChange={() => undefined}
        onNameChange={() => undefined}
        onWeightChange={() => undefined}
        onDescChange={() => undefined}
        discoveryField={field}
      />,
    );

    expect(html).toContain(`ideal: ${derivedAxis.idealValue} ${field.unit}`);
    expect(html).toContain(
      `Veto ${derivedAxis.veto?.direction} ${derivedAxis.veto?.threshold} ${field.unit}`,
    );
  });

  test("uses the selected field unit in the shared create and update veto confirmation", () => {
    const confirmMock = mock(() => true);
    globalThis.confirm = confirmMock;
    const curve = curveStateFromAxis(derivedAxis);

    expect(confirmVetoEnablement(curve, field.unit)).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(
      `This will set any game scoring above 180 ${field.unit} on this axis to fitness 0. Continue?`,
    );
  });

  test("threads field errors through legacy repair and invokes Repair Axis", () => {
    const onRepair = mock(() => undefined);
    const confirmMock = mock(() => true);
    globalThis.confirm = confirmMock;
    const props: Parameters<typeof LegacyAxisCard>[0] = {
      axis: legacyAxis,
      fields: [field],
      ratingsCount: 2,
      repairing: true,
      repairField: field,
      configuration: configurationDraftFromField(field),
      curve: curveStateFromAxis(legacyAxis),
      formError: { summary: "Repair rejected.", fields: errors },
      onStartRepair: () => undefined,
      onSelectField: () => undefined,
      onConfigurationChange: () => undefined,
      onCurveChange: () => undefined,
      onCancel: () => undefined,
      onRepair,
      onDelete: () => undefined,
    };
    const card = LegacyAxisCard(props);
    const html = renderToStaticMarkup(card);

    expect(html).toContain(errors.idealValue);
    expect(html).toContain(errors.toleranceWidth);
    expect(html).toContain(errors["veto.threshold"]);
    expect(html).toContain(`Veto threshold (${field.unit})`);
    const repair = descendants(card).find((element) => text(element) === "Repair Axis");
    if (!repair) throw new Error("Expected Repair Axis action");
    (repair.props as { onClick: () => void }).onClick();
    expect(confirmMock).toHaveBeenCalledWith(
      `This will set any game scoring above 180 ${field.unit} on this axis to fitness 0. Continue?`,
    );
    expect(onRepair).toHaveBeenCalledTimes(1);
  });

  test("cancelled veto confirmation does not invoke the rendered repair action", () => {
    const onRepair = mock(() => undefined);
    const confirmMock = mock(() => false);
    globalThis.confirm = confirmMock;
    const card = LegacyAxisCard({
      axis: legacyAxis,
      fields: [field],
      ratingsCount: 2,
      repairing: true,
      repairField: field,
      configuration: configurationDraftFromField(field),
      curve: curveStateFromAxis(legacyAxis),
      formError: undefined,
      onStartRepair: () => undefined,
      onSelectField: () => undefined,
      onConfigurationChange: () => undefined,
      onCurveChange: () => undefined,
      onCancel: () => undefined,
      onRepair,
      onDelete: () => undefined,
    });
    const repair = descendants(card).find((element) => text(element) === "Repair Axis");
    if (!repair) throw new Error("Expected Repair Axis action");

    (repair.props as { onClick: () => void }).onClick();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onRepair).not.toHaveBeenCalled();
  });
});
