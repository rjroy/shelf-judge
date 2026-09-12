"use client";

import {
  REFLECTION_QUESTIONS,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionStreamEventSchema,
  type ReflectionGetResult,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateBrowserUuid } from "@/lib/browser-uuid";
import { ReflectionCard } from "./reflection-card";
import { ReflectionDisclosure } from "./reflection-disclosure";

const REFLECTIONS_PATH = "/api/daemon/profile/reflections";

type ReflectionClientDiagnostic = {
  readonly batchId: string;
  readonly requestId: string;
  readonly transition: string;
  readonly trigger: string;
  readonly questionId?: ReflectionQuestionId;
  readonly reason?: string;
};

function logReflectionDiagnostic(diagnostic: ReflectionClientDiagnostic): void {
  // Deliberately limited to correlation and lifecycle metadata: never stream content or credentials.
  console.info("[reflection-refresh]", diagnostic);
}

function requestId(): string {
  return generateBrowserUuid();
}

function cancellationCapability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function reflectionJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${REFLECTIONS_PATH}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const operation = ReflectionOperationResultSchema.safeParse(value);
    throw new Error(
      operation.success
        ? `Reflection request ${operation.data.outcome}`
        : "Reflection request failed",
    );
  }
  return value;
}

export function OptionalReflections() {
  const [data, setData] = useState<ReflectionGetResult | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "unavailable">("loading");
  const [pendingQuestion, setPendingQuestion] = useState<ReflectionQuestionId | undefined>();
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const active = useRef<
    | { batchId: string; requestId: string; capability: string; controller: AbortController }
    | undefined
  >(undefined);
  const disclosureTrigger = useRef<HTMLElement | null>(null);
  const restoreDisclosureFocus = useCallback(() => {
    setDisclosureOpen(false);
    requestAnimationFrame(() => disclosureTrigger.current?.focus());
  }, []);
  const updateStates = useCallback(
    (
      update: (
        state: ReflectionGetResult["questions"][number],
      ) => ReflectionGetResult["questions"][number],
    ) => {
      setData((current) =>
        current === null
          ? current
          : ReflectionGetResultSchema.parse({
              ...current,
              questions: current.questions.map(update),
            }),
      );
    },
    [],
  );
  const load = useCallback(async () => {
    try {
      setData(ReflectionGetResultSchema.parse(await reflectionJson("")));
      setLoadState("loading");
    } catch {
      setLoadState("unavailable");
      setMessage(
        "Optional reflections are unavailable. Your deterministic Profile remains available.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      const current = active.current;
      if (current !== undefined) {
        navigator.sendBeacon(
          `${REFLECTIONS_PATH}/cancel`,
          new Blob([JSON.stringify({ batchId: current.batchId, capability: current.capability })], {
            type: "application/json",
          }),
        );
        current.controller.abort();
      }
    };
  }, [load]);

  const cancel = useCallback(async () => {
    const current = active.current;
    if (current === undefined) return;
    try {
      await reflectionJson("/cancel", {
        method: "POST",
        body: JSON.stringify({ batchId: current.batchId, capability: current.capability }),
      });
    } finally {
      current.controller.abort();
      active.current = undefined;
      setMessage("Refresh cancelled.");
      updateStates((state) =>
        state.attempt.state === "refreshing"
          ? { ...state, attempt: { state: "cancelled", occurredAt: new Date().toISOString() } }
          : state,
      );
      void load();
    }
  }, [load, updateStates]);

  const refresh = useCallback(async () => {
    if (active.current !== undefined) {
      setMessage("A reflection refresh is already running.");
      return;
    }
    if (data === null) return;
    if (data.configuration.status !== "configured") {
      setMessage("Model configuration is unavailable.");
      return;
    }
    restoreDisclosureFocus();
    const batchId = requestId();
    const refreshRequestId = requestId();
    const capability = cancellationCapability();
    const controller = new AbortController();
    active.current = { batchId, requestId: refreshRequestId, capability, controller };
    logReflectionDiagnostic({
      batchId,
      requestId: refreshRequestId,
      transition: "idle->refreshing",
      trigger: "refresh-confirmed",
      ...(pendingQuestion === undefined ? {} : { questionId: pendingQuestion }),
    });
    setMessage("Refreshing reflections.");
    updateStates((state) =>
      state.enabled && (pendingQuestion === undefined || state.questionId === pendingQuestion)
        ? {
            ...state,
            attempt: { state: "refreshing", batchId, startedAt: new Date().toISOString() },
          }
        : state,
    );
    try {
      const response = await fetch(`${REFLECTIONS_PATH}/refresh`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          requestId: refreshRequestId,
          cancellationCapability: capability,
          ...(pendingQuestion === undefined ? {} : { questionId: pendingQuestion }),
          disclosure: {
            version: 1,
            providerId: data.configuration.identity.providerId,
            modelId: data.configuration.identity.modelId,
            acknowledged: true,
          },
        }),
      });
      if (!response.ok || response.body === null) throw new Error("Unable to start refresh");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalOutcome = false;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const payload = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (payload === undefined) continue;
          const event = ReflectionStreamEventSchema.parse(JSON.parse(payload));
          if (event.type === "question-started") {
            setMessage(`Refreshing ${event.questionId}.`);
          }
          if (event.type === "evidence-retrieval") {
            setMessage(
              event.status === "started"
                ? `Retrieving evidence for ${event.questionId}.`
                : `Retrieved ${event.examinedItemCount} evidence items for ${event.questionId}.`,
            );
          }
          if (event.type === "validated-result") {
            updateStates((state) =>
              state.questionId === event.questionId
                ? { ...state, cache: { state: "current", result: event.result } }
                : state,
            );
          }
          if (event.type === "question-completed") {
            if (event.terminal) {
              terminalOutcome = true;
              logReflectionDiagnostic({
                batchId,
                requestId: refreshRequestId,
                transition: "refreshing->idle",
                trigger: "terminal-event-received",
                questionId: event.questionId,
              });
            }
            updateStates((state) =>
              state.questionId === event.questionId
                ? { ...state, attempt: { state: "idle" } }
                : state,
            );
          }
          if (event.type === "cancelled") {
            terminalOutcome = true;
            logReflectionDiagnostic({
              batchId,
              requestId: refreshRequestId,
              transition: "refreshing->cancelled",
              trigger: "terminal-event-received",
              ...(event.questionId === undefined ? {} : { questionId: event.questionId }),
            });
            updateStates((state) =>
              event.questionId === undefined || state.questionId === event.questionId
                ? { ...state, attempt: { state: "cancelled", occurredAt: event.occurredAt } }
                : state,
            );
            setMessage("Refresh cancelled.");
          }
          if (event.type === "failed") {
            terminalOutcome = true;
            logReflectionDiagnostic({
              batchId,
              requestId: refreshRequestId,
              transition: "refreshing->unavailable",
              trigger: "terminal-event-received",
              ...(event.questionId === undefined ? {} : { questionId: event.questionId }),
              reason: event.reason,
            });
            updateStates((state) =>
              event.questionId === undefined || state.questionId === event.questionId
                ? {
                    ...state,
                    attempt: {
                      state: "unavailable",
                      reason: event.reason,
                      ...(event.safeDetail === undefined ? {} : { safeDetail: event.safeDetail }),
                      occurredAt: event.occurredAt,
                    },
                  }
                : state,
            );
            setMessage(`Reflection refresh unavailable: ${event.reason}.`);
          }
        }
      }
      if (!terminalOutcome) {
        logReflectionDiagnostic({
          batchId,
          requestId: refreshRequestId,
          transition: "refreshing->unavailable",
          trigger: "terminal-event-missed",
          ...(pendingQuestion === undefined ? {} : { questionId: pendingQuestion }),
          reason: "transport",
        });
        updateStates((state) =>
          state.attempt.state === "refreshing"
            ? {
                ...state,
                attempt: {
                  state: "unavailable",
                  reason: "transport",
                  safeDetail: "terminal-event-missed",
                  occurredAt: new Date().toISOString(),
                },
              }
            : state,
        );
        setMessage("Reflection refresh ended before a terminal status was received.");
      }
    } catch {
      if (!controller.signal.aborted) {
        logReflectionDiagnostic({
          batchId,
          requestId: refreshRequestId,
          transition: "refreshing->unavailable",
          trigger: "stream-error",
          ...(pendingQuestion === undefined ? {} : { questionId: pendingQuestion }),
          reason: "transport",
        });
        updateStates((state) =>
          state.attempt.state === "refreshing"
            ? {
                ...state,
                attempt: {
                  state: "unavailable",
                  reason: "transport",
                  safeDetail: "refresh-stream-error",
                  occurredAt: new Date().toISOString(),
                },
              }
            : state,
        );
        setMessage("Reflection refresh failed before a terminal status was received.");
      }
    } finally {
      if (active.current?.batchId === batchId) active.current = undefined;
      setPendingQuestion(undefined);
      void load();
    }
  }, [data, load, pendingQuestion, restoreDisclosureFocus, updateStates]);

  const updateQuestion = useCallback(
    async (questionId: ReflectionQuestionId, enabled: boolean) => {
      try {
        await reflectionJson("/settings", {
          method: "PUT",
          body: JSON.stringify({ requestId: requestId(), questionId, enabled }),
        });
        await load();
      } catch {
        setMessage("Unable to update that question.");
      }
    },
    [load],
  );

  const deleteAll = useCallback(async () => {
    if (
      !window.confirm(
        "Delete all saved reflection output? This does not change your collection or question settings.",
      )
    )
      return;
    try {
      await reflectionJson("", {
        method: "DELETE",
        body: JSON.stringify({ requestId: requestId(), confirmed: true }),
      });
      setMessage("All reflection output was deleted.");
      await load();
    } catch {
      setMessage("Unable to delete reflection output.");
    }
  }, [load]);

  const enabledQuestions = data?.questions.filter(({ enabled }) => enabled) ?? [];
  const refreshInProgress =
    active.current !== undefined ||
    (data?.questions.some(({ attempt }) => attempt.state === "refreshing") ?? false);
  return (
    <section className="optional-reflections" aria-labelledby="optional-reflections-heading">
      <h3 id="optional-reflections-heading">Optional reflections</h3>
      <p>These optional, cited reflections never replace the deterministic Profile above.</p>
      <p className="reflection-live" role="status" aria-live="polite">
        {message}
      </p>
      {data === null ? (
        loadState === "unavailable" ? (
          <div className="reflection-status" role="status">
            <p>
              Optional reflections are unavailable. Your deterministic Profile remains available.
            </p>
            <button className="btn btn-secondary" type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : (
          <p>Loading optional reflection status…</p>
        )
      ) : (
        <>
          {disclosureOpen ? (
            <ReflectionDisclosure
              configuration={data.configuration}
              questionCount={pendingQuestion === undefined ? enabledQuestions.length : 1}
              onConfirm={() => void refresh()}
              onCancel={() => {
                setPendingQuestion(undefined);
                restoreDisclosureFocus();
              }}
            />
          ) : null}
          <div className="profile-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={(event) => {
                disclosureTrigger.current = event.currentTarget;
                setDisclosureOpen(true);
              }}
              disabled={enabledQuestions.length === 0 || refreshInProgress}
            >
              Refresh reflections
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void deleteAll()}>
              Delete all reflections
            </button>
          </div>
          <fieldset className="reflection-settings">
            <legend>Questions to include</legend>
            {data.questions.map((state) => {
              const question = REFLECTION_QUESTIONS.find(({ id }) => id === state.questionId);
              if (question === undefined) return null;
              return (
                <label key={state.questionId}>
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    disabled={refreshInProgress}
                    onChange={(event) =>
                      void updateQuestion(state.questionId, event.target.checked)
                    }
                  />
                  {question.wording}
                </label>
              );
            })}
          </fieldset>
          {data.questions
            .filter(({ enabled }) => enabled)
            .map((state) => {
              const question = REFLECTION_QUESTIONS.find(({ id }) => id === state.questionId);
              if (question === undefined) return null;
              return (
                <ReflectionCard
                  key={state.questionId}
                  state={state}
                  wording={question.wording}
                  onRefresh={(questionId) => {
                    setPendingQuestion(questionId);
                    disclosureTrigger.current = document.activeElement as HTMLElement | null;
                    setDisclosureOpen(true);
                  }}
                  onToggle={(questionId, enabled) => void updateQuestion(questionId, enabled)}
                  onCancel={() => void cancel()}
                  refreshDisabled={refreshInProgress}
                />
              );
            })}
        </>
      )}
    </section>
  );
}
