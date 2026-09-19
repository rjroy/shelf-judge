import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  REFLECTION_QUESTION_POLICIES,
  ReflectionQuestionStateSchema,
  type ReflectionQuestionState,
} from "@shelf-judge/shared";
import { ReflectionCard } from "./reflection-card";

function abstainedState(
  kind: "missing-current-testimony" | "existing-notes-not-examined" | "non-note-blocker",
  message: string,
): ReflectionQuestionState {
  const questionId = "recurring-trade-offs";
  return ReflectionQuestionStateSchema.parse({
    questionId,
    enabled: true,
    attempt: { state: "idle" },
    cache: {
      state: "current",
      result: {
        outcome: "abstained",
        reason: "no-owner-testimony",
        explanation: "The available evidence cannot support this reflection.",
        abstentionGuidance: {
          kind,
          message,
          refreshInstruction:
            "After editing, select Refresh this question to check the updated evidence.",
        },
        supportingBlocks: [],
        citations: [],
        scope: {
          examinedPresentNoteCount: 0,
          totalPresentNoteCount: null,
          examinedGameCount: 0,
          relevantEligibleGameCount: 2,
          excludedGameCount: 0,
          exhaustiveNotes: false,
        },
        evidenceIdentity: {
          manifestVersion: 2,
          questionId,
          questionVersion: REFLECTION_QUESTION_POLICIES[questionId].questionVersion,
          collectionId: "collection",
          collectionSchemaVersion: 6,
          collectionRevision: 1,
          profileContractVersion: 1,
          profileAlgorithmVersion: 1,
          providerId: "provider",
          modelId: "model",
        },
        dependencies: [],
        generatedAt: "2026-09-19T12:00:00.000Z",
        usage: { state: "unavailable" },
      },
    },
  });
}

describe("ReflectionCard abstention guidance", () => {
  test.each([
    [
      "missing-current-testimony" as const,
      "No current owner testimony was available; relevant notes might help but do not guarantee an answer.",
    ],
    [
      "existing-notes-not-examined" as const,
      "Current notes are present but were not examined; adding more notes may not help.",
    ],
    [
      "non-note-blocker" as const,
      "The supported pattern is missing, so more notes may not produce an answer.",
    ],
  ])("renders %s with precise manual refresh and no broad note list", (kind, message) => {
    const html = renderToStaticMarkup(
      <ReflectionCard
        state={abstainedState(kind, message)}
        gameTitles={new Map()}
        wording="What trade-offs recur?"
        onRefresh={() => undefined}
        onToggle={() => undefined}
        onCancel={() => undefined}
        refreshDisabled={false}
      />,
    );

    expect(html).toContain(message);
    expect(html).toContain("After editing, select Refresh this question");
    expect(html).toContain(">Refresh this question</button>");
    expect(html).not.toContain("Add notes for");
  });
});
