import { describe, expect, mock, test } from "bun:test";
import type { Axis, FitnessResult } from "@shelf-judge/shared";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { RatingFormContent, type RatingFormProps } from "@/components/rating-form";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function successfulRequest() {
  return mock(() =>
    Promise.resolve(new Response("{}", { status: 200 })),
  ) as unknown as typeof fetch;
}

function renderForm(
  overrides: Partial<RatingFormProps> = {},
  request: typeof fetch = successfulRequest(),
  refresh = mock(() => undefined),
): { renderer: ReactTestRenderer; request: typeof fetch; refresh: ReturnType<typeof mock> } {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <RatingFormContent
        gameId="game-1"
        axes={[personalAxis, derivedAxis]}
        currentRatings={{}}
        {...overrides}
        request={request}
        refresh={refresh}
      />,
    );
  });
  if (!renderer) throw new Error("Expected rating form renderer");
  return { renderer, request, refresh };
}

function derivedScore(
  axis: Axis,
  derivedField: "playerCountFit" | "playingTime",
  sourceValue: number | null,
  effectiveRating: number | null,
): FitnessResult {
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
        unit: derivedField === "playingTime" ? "minutes" : "fit score",
        provenance: `Published ${derivedField}`,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        configurationSummary:
          derivedField === "playingTime" ? "Scoring cap: 240 minutes" : "Target: 4 players",
        overridden: false,
        overrideValue: null,
        predictionConfidence: null,
        referenceGames: null,
      },
    ],
  };
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const match = renderer.root
    .findAllByType("button")
    .find((candidate) => text(candidate) === label);
  if (!match) throw new Error(`Expected button ${label}`);
  return match;
}

function overrideInput(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByProps({ className: "rating-value-input override-value-input" });
}

function requestCalls(request: typeof fetch): Array<[string | URL | Request, RequestInit?]> {
  return (
    request as unknown as {
      mock: { calls: Array<[string | URL | Request, RequestInit?]> };
    }
  ).mock.calls;
}

async function submit(renderer: ReactTestRenderer): Promise<void> {
  const form = renderer.root.findByType("form");
  await act(async () => {
    form.props.onSubmit({ preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RatingForm rendered workflows", () => {
  test("excludes disabled legacy ratings from a submitted unrelated save", async () => {
    const { renderer, request, refresh } = renderForm({
      axes: [personalAxis, disabledLegacyAxis],
      currentRatings: { [personalAxis.id]: 7, [disabledLegacyAxis.id]: 9 },
    });

    expect(text(renderer.root)).toContain(personalAxis.name);
    expect(text(renderer.root)).not.toContain(disabledLegacyAxis.name);
    await submit(renderer);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requestCalls(request)[0]?.[1]).toMatchObject({
      body: JSON.stringify({ ratings: { [personalAxis.id]: 7 } }),
    });
  });

  test("rounds a fractional effective rating to a valid override draft and submits it", async () => {
    const score = derivedScore(derivedAxis, "playingTime", 120, 7.5);
    const { renderer, request, refresh } = renderForm({ axes: [derivedAxis], score });

    act(() => button(renderer, "Override ›").props.onClick());
    expect(overrideInput(renderer).props.value).toBe("8");
    await submit(renderer);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requestCalls(request)[0]?.[1]).toMatchObject({
      body: JSON.stringify({ ratings: { [derivedAxis.id]: 8 } }),
    });
  });

  test("clears a supported derived override using null wire semantics", async () => {
    const { renderer, request, refresh } = renderForm({
      axes: [derivedAxis],
      currentRatings: { [derivedAxis.id]: 8 },
    });

    act(() => button(renderer, "Clear override ›").props.onClick());
    await submit(renderer);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requestCalls(request)[0]?.[1]).toMatchObject({
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
      const score = derivedScore(
        scenario.axis,
        scenario.field,
        scenario.sourceValue,
        scenario.effectiveRating,
      );
      const request = successfulRequest();
      const refresh = mock(() => undefined);
      const initial = renderForm({ axes: [scenario.axis], score }, request, refresh);

      act(() => button(initial.renderer, "Override ›").props.onClick());
      act(() =>
        overrideInput(initial.renderer).props.onChange({ target: { value: scenario.override } }),
      );
      expect(text(initial.renderer.root)).toContain(`Stored override (1-10): ${scenario.override}`);
      await submit(initial.renderer);
      expect(requestCalls(request)[0]?.[1]).toMatchObject({
        body: JSON.stringify({ ratings: { [scenario.axis.id]: Number(scenario.override) } }),
      });

      act(() => initial.renderer.unmount());
      const persisted = renderForm(
        {
          axes: [scenario.axis],
          currentRatings: { [scenario.axis.id]: Number(scenario.override) },
          score,
        },
        request,
        refresh,
      );
      expect(text(persisted.renderer.root)).toContain(
        `Stored override (1-10): ${scenario.override}`,
      );
      act(() => button(persisted.renderer, "Clear override ›").props.onClick());
      expect(text(persisted.renderer.root)).not.toContain("Stored override (1-10)");
      await submit(persisted.renderer);
      expect(requestCalls(request)[1]?.[1]).toMatchObject({
        body: JSON.stringify({ ratings: { [scenario.axis.id]: null } }),
      });
    });
  }

  test("renders rating labels and metadata fallback through the component", () => {
    const { renderer } = renderForm({
      axes: [personalAxis, derivedAxis],
      currentRatings: { [personalAxis.id]: 7 },
    });

    expect(text(renderer.root)).toContain("Very Good");
    expect(text(renderer.root)).toContain("Source metadata unavailable");
  });

  test("renders target, cap, and provenance facts from derived breakdowns", () => {
    const playerScore = derivedScore(playerCountAxis, "playerCountFit", 10, 10);
    const timeScore = derivedScore(derivedAxis, "playingTime", 300, 8);
    const score: FitnessResult = {
      ...playerScore,
      score: 8,
      ratedAxisCount: 2,
      totalAxisCount: 2,
      breakdown: [
        {
          ...playerScore.breakdown[0],
          provenance:
            "BoardGameGeek suggested-player-count poll with publisher-declared bounds fallback",
        },
        {
          ...timeScore.breakdown[0],
          scoringRawValue: 240,
          provenance: "Publisher-listed playing time imported from BoardGameGeek",
        },
      ],
    };

    const { renderer } = renderForm({ axes: [playerCountAxis, derivedAxis], score });
    const rendered = text(renderer.root);
    expect(rendered).toContain("Target: 4 players");
    expect(rendered).toContain(
      "BoardGameGeek suggested-player-count poll with publisher-declared bounds fallback",
    );
    expect(rendered).toContain("Scoring cap: 240 minutes");
    expect(rendered).toContain("Publisher-listed playing time imported from BoardGameGeek");
  });
});
