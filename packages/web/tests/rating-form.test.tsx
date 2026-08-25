import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Axis, FitnessResult } from "@shelf-judge/shared";
import type { ReactElement, ReactNode, SetStateAction } from "react";

const React = await import("react");
const refresh = mock(() => undefined);
const originalFetch = globalThis.fetch;
let states: unknown[] = [];
let stateIndex = 0;

void mock.module("react", () => ({
  ...React,
  useState: <T,>(initial: T | (() => T)) => {
    const index = stateIndex++;
    if (states.length <= index) {
      states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    const setState = (value: SetStateAction<T>) => {
      states[index] =
        typeof value === "function" ? (value as (previous: T) => T)(states[index] as T) : value;
    };
    return [states[index] as T, setState] as const;
  },
}));

void mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { RatingForm } = await import("@/components/rating-form");

const personalAxis: Axis = {
  id: "personal-axis",
  name: "Personal axis",
  description: null,
  enabled: true,
  source: "personal",
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const derivedAxis: Axis = {
  id: "derived-axis",
  name: "Play Time",
  description: null,
  enabled: true,
  source: "derived",
  derivedField: "playingTime",
  configuration: { maximumScoringTime: 240 },
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const playerCountAxis: Axis = {
  id: "player-count-axis",
  name: "Player Count Fit",
  description: null,
  enabled: true,
  source: "derived",
  derivedField: "playerCountFit",
  configuration: { targetPlayerCount: 4 },
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const disabledLegacyAxis: Axis = {
  id: "legacy-axis",
  name: "Old Play Time",
  description: null,
  enabled: false,
  source: "legacy",
  reason: "Unknown historical field",
  legacyField: "oldPlayingTime",
  legacyPayload: {},
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderForm(
  overrides: Partial<Parameters<typeof RatingForm>[0]> = {},
): ReactElement<Record<string, unknown>> {
  stateIndex = 0;
  return RatingForm({
    gameId: "game-1",
    axes: [personalAxis, derivedAxis],
    currentRatings: {},
    ...overrides,
  }) as ReactElement<Record<string, unknown>>;
}

function derivedScore(
  axis: Axis,
  derivedField: "playerCountFit" | "playingTime",
  sourceValue: number | null,
  effectiveRating: number | null,
): FitnessResult {
  const unit = derivedField === "playingTime" ? "minutes" : "fit score";
  return {
    score: effectiveRating ?? 0,
    ratedAxisCount: effectiveRating === null ? 0 : 1,
    totalAxisCount: 1,
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
    breakdown: [
      {
        axisId: axis.id,
        axisName: axis.name,
        weight: axis.weight,
        effectiveRating,
        contribution: effectiveRating,
        source: "derived",
        derivedField,
        sourceValue,
        scoringRawValue: sourceValue,
        unit,
        provenance: `Published ${derivedField}`,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        configurationSummary:
          derivedField === "playingTime" ? "Scoring cap: 240 minutes" : "Target: 4 players",
        overridden: false,
        predictionConfidence: null,
        referenceGames: null,
      },
    ],
  };
}

function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) {
    if (Array.isArray(node)) return node.flatMap(descendants);
    return [];
  }
  return [node, ...descendants(node.props.children as ReactNode)];
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Record<string, unknown>>(node))
    return text(node.props.children as ReactNode);
  return "";
}

function findElement(
  root: ReactElement<Record<string, unknown>>,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  const element = descendants(root).find(predicate);
  if (!element) throw new Error("Expected rendered element was not found");
  return element;
}

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  states = [];
  stateIndex = 0;
  refresh.mockClear();
  globalThis.fetch = originalFetch;
});

describe("RatingForm rendered workflows", () => {
  test("excludes disabled legacy ratings from a submitted unrelated save", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const form = renderForm({
      axes: [personalAxis, disabledLegacyAxis],
      currentRatings: { [personalAxis.id]: 7, [disabledLegacyAxis.id]: 9 },
    });

    expect(text(form)).toContain(personalAxis.name);
    expect(text(form)).not.toContain(disabledLegacyAxis.name);
    const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
    submit({ preventDefault: () => undefined });
    await flushMutation();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ ratings: { [personalAxis.id]: 7 } }),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("rounds a fractional effective rating to a valid override draft and submits it", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const score: FitnessResult = {
      score: 7.5,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
      breakdown: [
        {
          axisId: derivedAxis.id,
          axisName: derivedAxis.name,
          weight: derivedAxis.weight,
          effectiveRating: 7.5,
          contribution: 7.5,
          source: "derived",
          derivedField: "playingTime",
          sourceValue: 120,
          scoringRawValue: 120,
          unit: "minutes",
          provenance: "Published play time",
          preferenceShape: "higher-is-better",
          curveAffected: false,
          configurationSummary: "Scoring cap: 240 minutes",
          overridden: false,
          predictionConfidence: null,
          referenceGames: null,
        },
      ],
    };

    let form = renderForm({ axes: [derivedAxis], score });
    const override = findElement(form, (element) => text(element) === "Override ›");
    (override.props.onClick as () => void)();
    form = renderForm({ axes: [derivedAxis], score });

    const numberInput = findElement(
      form,
      (element) => element.type === "input" && element.props.type === "number",
    );
    expect(numberInput.props.value).toBe("8");
    const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
    submit({ preventDefault: () => undefined });
    await flushMutation();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ ratings: { [derivedAxis.id]: 8 } }),
    });
  });

  test("clears a supported derived override using null wire semantics", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let form = renderForm({
      axes: [derivedAxis],
      currentRatings: { [derivedAxis.id]: 8 },
    });
    const clear = findElement(form, (element) => text(element) === "Clear override ›");
    (clear.props.onClick as () => void)();
    form = renderForm({ axes: [derivedAxis], currentRatings: { [derivedAxis.id]: 8 } });

    const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
    submit({ preventDefault: () => undefined });
    await flushMutation();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ ratings: { [derivedAxis.id]: null } }),
    });
  });

  for (const scenario of [
    {
      label: "Player Count Fit with missing factual metadata",
      axis: playerCountAxis,
      field: "playerCountFit" as const,
      sourceValue: null,
      effectiveRating: null,
      override: "9",
    },
    {
      label: "Play Time with factual metadata",
      axis: derivedAxis,
      field: "playingTime" as const,
      sourceValue: 120,
      effectiveRating: 7,
      override: "6",
    },
  ]) {
    test(`enters, persists, displays, and clears ${scenario.label} overrides`, async () => {
      const fetchMock = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const score = derivedScore(
        scenario.axis,
        scenario.field,
        scenario.sourceValue,
        scenario.effectiveRating,
      );

      let form = renderForm({ axes: [scenario.axis], score });
      const override = findElement(
        form,
        (element) => element.type === "button" && text(element) === "Override ›",
      );
      expect(override.props.type).toBe("button");
      (override.props.onClick as () => void)();

      form = renderForm({ axes: [scenario.axis], score });
      const input = findElement(
        form,
        (element) => element.type === "input" && element.props.type === "number",
      );
      (input.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: scenario.override },
      });
      form = renderForm({ axes: [scenario.axis], score });
      expect(text(form)).toContain(`Stored override (1-10): ${scenario.override}`);

      const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
      submit({ preventDefault: () => undefined });
      await flushMutation();
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        body: JSON.stringify({ ratings: { [scenario.axis.id]: Number(scenario.override) } }),
      });

      states = [];
      form = renderForm({
        axes: [scenario.axis],
        currentRatings: { [scenario.axis.id]: Number(scenario.override) },
        score,
      });
      expect(text(form)).toContain(`Stored override (1-10): ${scenario.override}`);
      const clear = findElement(
        form,
        (element) => element.type === "button" && text(element) === "Clear override ›",
      );
      expect(clear.props.type).toBe("button");
      (clear.props.onClick as () => void)();

      form = renderForm({
        axes: [scenario.axis],
        currentRatings: { [scenario.axis.id]: Number(scenario.override) },
        score,
      });
      expect(text(form)).not.toContain("Stored override (1-10)");
      const clearSubmit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
      clearSubmit({ preventDefault: () => undefined });
      await flushMutation();
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        body: JSON.stringify({ ratings: { [scenario.axis.id]: null } }),
      });
    });
  }

  test("renders rating labels and metadata fallback through the component", () => {
    const form = renderForm({
      axes: [personalAxis, derivedAxis],
      currentRatings: { [personalAxis.id]: 7 },
    });
    expect(text(form)).toContain("Very Good");
    expect(text(form)).toContain("Source metadata unavailable");
  });

  test("renders target, cap, and provenance facts from derived breakdowns", () => {
    const score: FitnessResult = {
      score: 8,
      ratedAxisCount: 2,
      totalAxisCount: 2,
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
      breakdown: [
        {
          axisId: playerCountAxis.id,
          axisName: playerCountAxis.name,
          weight: playerCountAxis.weight,
          effectiveRating: 10,
          contribution: 10,
          source: "derived",
          derivedField: "playerCountFit",
          sourceValue: 10,
          scoringRawValue: 10,
          unit: "fit score",
          provenance: "Publisher-declared minimum and maximum player count",
          preferenceShape: "higher-is-better",
          curveAffected: false,
          configurationSummary: "Target: 4 players",
          overridden: false,
          predictionConfidence: null,
          referenceGames: null,
        },
        {
          axisId: derivedAxis.id,
          axisName: derivedAxis.name,
          weight: derivedAxis.weight,
          effectiveRating: 8,
          contribution: 8,
          source: "derived",
          derivedField: "playingTime",
          sourceValue: 300,
          scoringRawValue: 240,
          unit: "minutes",
          provenance: "Publisher-listed playing time imported from BoardGameGeek",
          preferenceShape: "sweet-spot",
          curveAffected: true,
          configurationSummary: "Scoring cap: 240 minutes",
          overridden: false,
          predictionConfidence: null,
          referenceGames: null,
        },
      ],
    };

    const form = renderForm({ axes: [playerCountAxis, derivedAxis], score });
    const renderedText = text(form);

    expect(renderedText).toContain("Target: 4 players");
    expect(renderedText).toContain("Publisher-declared minimum and maximum player count");
    expect(renderedText).toContain("Scoring cap: 240 minutes");
    expect(renderedText).toContain("Publisher-listed playing time imported from BoardGameGeek");
  });
});
