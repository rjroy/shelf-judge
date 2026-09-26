"use client";

import {
  AnalystConfigurationSchema,
  AnalystFinalSchema,
  AnalystStreamEventSchema,
  type AnalystCitation,
  type AnalystCitationInspectionRecord,
  type AnalystCitationInspectionView,
  type AnalystBggDiscoveryResult,
  type AnalystBggFitnessPreviewResult,
  type AnalystStreamEvent,
  type AnalystTurnRequest,
} from "@shelf-judge/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { generateBrowserUuid } from "@/lib/browser-uuid";

type Configuration = {
  readonly configuration: {
    readonly identity: { readonly providerId: string; readonly modelId: string };
  };
  readonly manifestVersion: number;
  readonly disclosureVersion: number;
  readonly disclosure: { readonly localRetention: string; readonly cancellation: string };
};
type Message = AnalystTurnRequest["messages"][number] & {
  citations?: AnalystCitation[];
  discovery?: AnalystBggDiscoveryResult[];
  fitnessPreview?: AnalystBggFitnessPreviewResult[];
  discoveryReceipts?: string[];
  discoveryIds?: { bggId: number; source: "search" | "hot" }[];
  discoveryDigest?: string;
  inspections?: AnalystCitationInspectionRecord[];
};
type InspectionOutcome = {
  state: "current" | "superseded" | "historical";
  destination?: unknown;
  inspectedAt?: string;
  view?: AnalystCitationInspectionView;
};
type LiveState = "idle" | "loading" | "streaming" | "cancelled" | "failed";

const markdownComponents = { a: ({ children }) => <span>{children}</span> } satisfies Components;

function id(): string {
  return generateBrowserUuid();
}

function conversationCapability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfiguration(value: unknown): Configuration {
  const parsed = AnalystConfigurationSchema.parse(value);
  if (!isRecord(value) || !isRecord(value.configuration) || !isRecord(value.disclosure)) {
    throw new Error("The Analyst configuration was invalid.");
  }
  const identity = value.configuration.identity;
  if (
    !isRecord(identity) ||
    typeof identity.providerId !== "string" ||
    typeof identity.modelId !== "string" ||
    typeof value.disclosure.localRetention !== "string" ||
    typeof value.disclosure.cancellation !== "string"
  ) {
    throw new Error("The Analyst configuration was invalid.");
  }
  return {
    manifestVersion: parsed.manifestVersion,
    disclosureVersion: parsed.disclosureVersion,
    configuration: { identity: { providerId: identity.providerId, modelId: identity.modelId } },
    disclosure: {
      localRetention: value.disclosure.localRetention,
      cancellation: value.disclosure.cancellation,
    },
  };
}

function progressFor(event: AnalystStreamEvent): string | undefined {
  if (event.type === "evidence-status")
    return event.status === "started"
      ? "Retrieving collection evidence…"
      : `Validated ${event.examinedItemCount} evidence sources.`;
  if (event.type === "model-status") {
    if (event.status === "started") return "Preparing the Analyst request…";
    if (event.status === "awaiting-submission") return "Waiting for the Analyst response…";
    return "Validating the Analyst response…";
  }
  return undefined;
}

function BggLink({ id, children }: { id: number; children: ReactNode }) {
  return (
    <a href={`https://boardgamegeek.com/boardgame/${id}`} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Discovery({ result }: { result: AnalystBggDiscoveryResult }) {
  if (result.status === "error")
    return (
      <section className="analyst-tool-card">
        <h3>
          {result.code === "BggThrottled"
            ? "BGG is temporarily limiting requests"
            : result.code === "BggUnauthorized" || result.code === "NotConfigured"
              ? "BGG access is not configured"
              : "BGG discovery could not be completed"}
        </h3>
        <p>
          Code: {result.code}.{" "}
          {result.retryable ? "You can ask again later." : "This request cannot be retried as-is."}
        </p>
      </section>
    );
  const title = result.source === "title";
  return (
    <section
      className="analyst-tool-card analyst-discovery"
      aria-label={title ? "BGG title matches" : "BGG Hot sample"}
    >
      <header>
        <h3>{title ? "BGG title matches" : "BGG Hot sample"}</h3>
        <span>
          {result.emittedCount} shown · {result.returnedCount} returned
        </span>
      </header>
      <p className="analyst-provenance">
        Source: {title ? "BGG title search" : "fixed boardgame Hot request"} · Observed{" "}
        {new Date(result.observedAt).toLocaleString()}
      </p>
      {result.truncated && <p role="note">Showing a bounded sample; more results were returned.</p>}
      {result.candidates.length ? (
        <ul className="analyst-candidates">
          {result.candidates.map((candidate) => (
            <li key={candidate.bggId}>
              <BggLink id={candidate.bggId}>
                <strong>{candidate.primaryName}</strong> · BGG {candidate.bggId}
              </BggLink>
              {candidate.yearPublished && <span> · {candidate.yearPublished}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {title
            ? "No matches in this title search."
            : "No useful candidates in this checked Hot sample."}
        </p>
      )}
      <p className="analyst-hint">
        If a match is ambiguous, inspect alternatives and tell the Analyst which game you mean.
      </p>
    </section>
  );
}

function FitnessPreview({ result }: { result: AnalystBggFitnessPreviewResult }) {
  if (result.status === "error")
    return (
      <section className="analyst-tool-card">
        <h3>Fitness preview unavailable</h3>
        <p>
          {result.code}.{" "}
          {result.retryable ? "Try again later." : "This preview cannot be retried as-is."}
        </p>
      </section>
    );
  if (result.state === "ambiguous")
    return (
      <section className="analyst-tool-card">
        <h3>Identity is ambiguous</h3>
        <p>Several collection entries may match BGG {result.bggId}. No score was selected.</p>
        <p>
          Possible collection IDs: {result.collectionGameIds.join(", ")}. Tell the Analyst which
          identity you mean.
        </p>
      </section>
    );
  if (result.state === "unavailable")
    return (
      <section className="analyst-tool-card">
        <h3>Fitness preview unavailable</h3>
        <p>
          BGG {result.bggId}: {result.code}.
          {result.predictionUnavailable
            ? ` Your profile is at readiness stage 0 (${result.predictionUnavailable.ratedGameCount} rated; ${result.predictionUnavailable.gamesNeeded} more needed).`
            : " No score is available."}
        </p>
      </section>
    );
  const score = result.score;
  const local = result.state === "existing-local-unverified";
  const existing = result.state !== "predicted";
  return (
    <section className="analyst-tool-card analyst-preview">
      <h3>{existing ? "Existing in collection" : "Predicted fitness"}</h3>
      <p>
        <strong>{local ? result.collectionName : result.primaryName}</strong> · BGG {result.bggId}
        {local && " · Local identity; BGG not verified"}
      </p>
      <p className="analyst-score">
        <span>{score.value.toFixed(1)}</span> / 10{" "}
        <strong>{score.label === "actual" ? "Current actual score" : "Predicted score"}</strong>
      </p>
      <p>
        Readiness stage {score.readinessStage}
        {score.confidence && ` · Confidence: ${score.confidence}`}
        {score.predictionUnavailable &&
          ` · Personal prediction unavailable at stage 0 (${score.predictionUnavailable.ratedGameCount} rated, ${score.predictionUnavailable.gamesNeeded} more needed)`}
      </p>
      {!local && (
        <p>BGG identity verified · {new Date(result.bggLookup.observedAt).toLocaleString()}</p>
      )}
      {local && <p>BGG lookup failed: {result.bggLookup.code}. This is a local-only score.</p>}
      <details>
        <summary>Score details and sources</summary>
        <p>
          Calculated {new Date(result.calculatedAt).toLocaleString()} · Source version{" "}
          {result.sourceVersion}
        </p>
        {score.axes.length > 0 && (
          <ul>
            {score.axes.map((axis) => (
              <li key={axis.axisId}>
                {axis.axisName}: {axis.value === null ? "Not available" : axis.value.toFixed(1)} ·{" "}
                {axis.source}
                {axis.confidence ? ` · ${axis.confidence} confidence` : ""}
              </li>
            ))}
          </ul>
        )}
        {score.referenceGames.length > 0 && (
          <p>
            Reference games:{" "}
            {score.referenceGames.map((game) => `${game.gameName} (${game.gameId})`).join(", ")}
          </p>
        )}
        {existing && (
          <p>
            Collection entry: {result.collectionGameId} · {result.ownership}
          </p>
        )}
      </details>
      <p className="analyst-hint">Read-only preview. Nothing was added or changed.</p>
    </section>
  );
}

async function readEvents(response: Response, onEvent: (event: AnalystStreamEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The Analyst stream was unavailable.");
  const decoder = new TextDecoder();
  let buffered = "";
  let terminal = false;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffered += decoder.decode(result.value, { stream: true });
    const records = buffered.split("\n\n");
    buffered = records.pop() ?? "";
    for (const record of records) {
      const payload = record
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!payload) continue;
      const parsed = AnalystStreamEventSchema.safeParse(JSON.parse(payload));
      if (!parsed.success) throw new Error("The Analyst returned an invalid stream event.");
      onEvent(parsed.data);
      if (["completed", "cancelled", "failed"].includes(parsed.data.type)) terminal = true;
    }
  }
  if (!terminal)
    throw new Error(
      "The Analyst connection ended before a complete response. Retry your question.",
    );
}

function InspectionView({ view }: { view: AnalystCitationInspectionView }) {
  if (view.kind === "discovery")
    return (
      <div>
        <p>
          BGG{" "}
          {view.result.status === "ok"
            ? `${view.result.source} observation · ${view.result.emittedCount} shown of ${view.result.returnedCount} returned · observed ${new Date(view.result.observedAt).toLocaleString()}`
            : `discovery failed: ${view.result.code}`}
        </p>
        {view.result.status === "ok" && (
          <ul>
            {view.result.candidates.map((candidate) => (
              <li key={candidate.bggId}>
                <BggLink id={candidate.bggId}>
                  {candidate.primaryName} · BGG {candidate.bggId}
                  {candidate.yearPublished ? ` · ${candidate.yearPublished}` : ""}
                </BggLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  if (view.kind === "calculation")
    return (
      <div>
        <p>
          Fitness calculation ·{" "}
          {"calculatedAt" in view.result
            ? new Date(view.result.calculatedAt).toLocaleString()
            : "time unavailable"}
        </p>
        <pre>{JSON.stringify(view.result, null, 2)}</pre>
      </div>
    );
  return (
    <div>
      <p>BGG facts recorded with this answer (historical; no refresh performed).</p>
      <pre>{JSON.stringify(view.result, null, 2)}</pre>
    </div>
  );
}

function Modal({
  titleId,
  children,
  onClose,
}: {
  titleId: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const buttons = () =>
      Array.from(element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    buttons()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const targets = buttons();
      const first = targets[0];
      const last = targets.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="analyst-dialog-backdrop">
      <section
        ref={dialog}
        className="analyst-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </section>
    </div>
  );
}

function Disclosure({
  configuration,
  onAcknowledge,
  onClose,
}: {
  configuration: Configuration;
  onAcknowledge: () => void;
  onClose: () => void;
}) {
  return (
    <Modal titleId="analyst-disclosure-title" onClose={onClose}>
      <h2 id="analyst-disclosure-title">Before sending your question</h2>
      <p>
        Your question and relevant collection evidence are sent to{" "}
        <strong>
          {configuration.configuration.identity.providerId} /{" "}
          {configuration.configuration.identity.modelId}
        </strong>
        .
      </p>
      <p>
        {configuration.disclosure.localRetention} Relevant owner notes may be transmitted. Provider
        processing and retention follow its policy.
      </p>
      <p>
        If the Analyst uses a BGG tool, a title or explicit BGG ID mentioned in your chat may be
        sent to BoardGameGeek. Hot uses a separate fixed request and does not include your question.
        BGG processing is separate from provider processing.
      </p>
      <p>This application has no token or monetary cap. {configuration.disclosure.cancellation}</p>
      <div className="analyst-actions">
        <button type="button" onClick={onClose}>
          Leave without sending
        </button>
        <button type="button" className="primary-button" onClick={onAcknowledge}>
          Acknowledge and send
        </button>
      </div>
    </Modal>
  );
}

export function AnalystChat() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [live, setLive] = useState("Loading Analyst configuration…");
  const [state, setState] = useState<LiveState>("loading");
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [inspectionOutcomes, setInspectionOutcomes] = useState<Record<string, InspectionOutcome>>(
    {},
  );
  const composer = useRef<HTMLTextAreaElement>(null);
  const active = useRef<{
    conversationId: string;
    capability: string;
    requestId: string;
    controller: AbortController;
  } | null>(null);
  const conversation = useRef({ conversationId: id(), capability: conversationCapability() });

  useEffect(() => {
    fetch("/api/daemon/analyst/configuration")
      .then(async (response) => parseConfiguration(await response.json()))
      .then((value) => {
        setConfiguration(value);
        setState("idle");
        setLive("Ready for a collection question.");
      })
      .catch(() => {
        setState("failed");
        setLive("Analyst configuration is unavailable. Try again later.");
      });
  }, []);

  useEffect(() => {
    if (state === "cancelled") composer.current?.focus();
  }, [state]);

  const submit = async (content: string, priorMessages = messages) => {
    if (!configuration || !content.trim() || active.current) return;
    const requestId = id();
    const controller = new AbortController();
    const request = { ...conversation.current, requestId, controller };
    active.current = request;
    const owner = { role: "owner" as const, content: content.trim() };
    const projectedMessages = [...priorMessages, owner].map((message) =>
      message.role === "owner"
        ? { role: "owner" as const, content: message.content }
        : {
            role: "analyst" as const,
            content: message.content,
            outcome: message.outcome,
            noteDependencies: message.noteDependencies,
            validationAttestation: message.validationAttestation,
            ...(message.discoveryIds ? { discoveryIds: message.discoveryIds } : {}),
            ...(message.discoveryDigest ? { discoveryDigest: message.discoveryDigest } : {}),
          },
    );
    const firstMessage = projectedMessages[0];
    if (!firstMessage) throw new Error("The Analyst question could not be prepared.");
    const transcript: AnalystTurnRequest["messages"] = [
      firstMessage,
      ...projectedMessages.slice(1),
    ];
    const discoveryReceipts = Array.from(
      new Set(
        priorMessages.flatMap((message) =>
          message.role === "analyst" ? (message.discoveryReceipts ?? []) : [],
        ),
      ),
    ).slice(-20);
    setMessages([...priorMessages, owner]);
    setQuestion("");
    setState("streaming");
    setLive("Sending your question…");
    try {
      const response = await fetch("/api/daemon/analyst/turns/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: request.conversationId,
          conversationCapability: request.capability,
          requestId,
          turnIndex: priorMessages.filter((message) => message.role === "analyst").length,
          discoveryReceipts,
          disclosure: {
            providerId: configuration.configuration.identity.providerId,
            modelId: configuration.configuration.identity.modelId,
            manifestVersion: configuration.manifestVersion,
            disclosureVersion: configuration.disclosureVersion,
            acknowledged: true,
          },
          messages: transcript,
        }),
      });
      if (!response.ok) throw new Error("The Analyst could not start this question.");
      await readEvents(response, (event) => {
        if (active.current?.requestId !== event.requestId) return;
        const progress = progressFor(event);
        if (progress) setLive(progress);
        if (event.type === "completed") {
          const final = AnalystFinalSchema.parse(event.result);
          setMessages((current) => [
            ...current,
            {
              role: "analyst",
              content: final.blocks.map((block) => block.text).join("\n\n"),
              outcome: final.outcome,
              noteDependencies: event.noteDependencies,
              validationAttestation: event.validationAttestation,
              citations: final.citations,
              discovery: event.discovery,
              fitnessPreview: event.fitnessPreview,
              discoveryReceipts: event.discoveryReceipts,
              discoveryIds: event.discoveryIds,
              discoveryDigest: event.discoveryDigest,
              inspections: event.citationInspections,
            },
          ]);
          setPendingQuestion(null);
          setState("idle");
          setLive("Validated answer complete.");
        } else if (event.type === "cancelled") {
          active.current = null;
          setState("cancelled");
          setLive("The Analyst request was cancelled.");
        } else if (event.type === "failed") {
          setState("failed");
          setLive(`The Analyst is unavailable: ${event.reason}.`);
        }
      });
    } catch (error) {
      if (active.current?.requestId === requestId && !controller.signal.aborted) {
        setState("failed");
        setLive(error instanceof Error ? error.message : "The Analyst request failed.");
      }
    } finally {
      if (active.current?.requestId === requestId) active.current = null;
    }
  };

  const cancel = () => {
    const request = active.current;
    if (!request) return;
    setLive("Cancelling the Analyst request…");
    void fetch("/api/daemon/analyst/turns/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: request.conversationId,
        conversationCapability: request.capability,
        requestId: request.requestId,
      }),
    }).catch(() => undefined);
    request.controller.abort();
    active.current = null;
    setState("cancelled");
    setLive("The Analyst request was cancelled.");
  };
  const inspect = async (
    citation: AnalystCitation,
    inspection?: AnalystCitationInspectionRecord,
  ) => {
    const response = await fetch("/api/daemon/analyst/citations/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        citation: {
          citationId: citation.citationId,
          sourceId: citation.sourceId,
          sourceVersion: citation.sourceVersion,
          evidenceClass: citation.evidenceClass,
        },
        ...(inspection ? { inspection } : {}),
      }),
    });
    if (!response.ok) {
      setLive("This citation could not be opened. Try again later.");
      return;
    }
    const result: unknown = await response.json();
    if (isRecord(result) && result.state === "historical") {
      setInspectionOutcomes((current) => ({
        ...current,
        [citation.citationId]: result as InspectionOutcome,
      }));
      setLive("Showing the historical evidence recorded with this answer; BGG was not contacted.");
      return;
    }
    if (!isRecord(result)) return;
    if (result.state === "current" || result.state === "superseded") {
      setInspectionOutcomes((current) => ({
        ...current,
        [citation.citationId]: result as InspectionOutcome,
      }));
    }
    const destination = result.destination;
    if (
      isRecord(destination) &&
      destination.operationId === "shelf.game.get" &&
      isRecord(destination.parameters) &&
      typeof destination.parameters.gameId === "string"
    )
      window.location.assign(`/games/${destination.parameters.gameId}`);
  };
  const retry = () => {
    if (!pendingQuestion) return;
    const priorMessages = messages.at(-1)?.role === "owner" ? messages.slice(0, -1) : messages;
    setMessages(priorMessages);
    void submit(pendingQuestion, priorMessages);
  };
  const reset = () => {
    conversation.current = { conversationId: id(), capability: conversationCapability() };
    active.current = null;
    setMessages([]);
    setInspectionOutcomes({});
    setPendingQuestion(null);
    setResetConfirmation(false);
    setState("idle");
    setLive("New ephemeral conversation started. Nothing was saved.");
  };

  return (
    <>
      <main className="page-content analyst-page" inert={showDisclosure || resetConfirmation}>
        <header className="page-header">
          <div>
            <h1>Collection Analyst</h1>
            <p>Ask read-only questions about your collection.</p>
          </div>
          <button
            type="button"
            onClick={() => setResetConfirmation(true)}
            disabled={state === "streaming"}
          >
            New conversation
          </button>
        </header>
        <p className="analyst-disclosure-summary">
          Analyst conversations are ephemeral and are not saved by Shelf Judge.
        </p>
        <section className="analyst-transcript" aria-label="Analyst conversation">
          {messages.length === 0 ? (
            <p>Ask a first question to start an ephemeral conversation.</p>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`analyst-message analyst-message-${message.role}`}
              >
                <h2>{message.role === "owner" ? "You" : "Collection Analyst"}</h2>
                {message.role === "analyst" ? (
                  <div className="analyst-markdown">
                    <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
                {message.role === "analyst" && message.citations?.length ? (
                  <ul aria-label="Citations">
                    {message.citations.map((citation) => (
                      <li key={citation.citationId}>
                        <button
                          type="button"
                          onClick={() =>
                            void inspect(
                              citation,
                              message.inspections?.find(
                                (record) => record.citation.citationId === citation.citationId,
                              ),
                            )
                          }
                        >
                          {citation.testimony ? "Owner testimony" : "Evidence"}:{" "}
                          {citation.canonicalSummary}
                        </button>
                        {inspectionOutcomes[citation.citationId] && (
                          <div className="analyst-inspection-result">
                            <p>
                              {inspectionOutcomes[citation.citationId]?.state === "historical"
                                ? `Historical evidence · inspected ${inspectionOutcomes[citation.citationId]?.inspectedAt ? new Date(inspectionOutcomes[citation.citationId]?.inspectedAt ?? "").toLocaleString() : ""} · BGG was not contacted.`
                                : inspectionOutcomes[citation.citationId]?.state === "superseded"
                                  ? "This evidence has been superseded; the record shown below is from the original answer."
                                  : "This evidence is current."}{" "}
                              Source version {citation.sourceVersion}
                              {citation.observedAt
                                ? ` · Observed ${new Date(citation.observedAt).toLocaleString()}`
                                : ""}
                              .
                            </p>
                            {inspectionOutcomes[citation.citationId]?.view && (
                              <InspectionView
                                view={
                                  inspectionOutcomes[citation.citationId]
                                    .view as AnalystCitationInspectionView
                                }
                              />
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.role === "analyst" &&
                  message.discovery?.map((result, discoveryIndex) => (
                    <Discovery key={`discovery-${discoveryIndex}`} result={result} />
                  ))}
                {message.role === "analyst" &&
                  message.fitnessPreview?.map((result, previewIndex) => (
                    <FitnessPreview key={`preview-${previewIndex}`} result={result} />
                  ))}
              </article>
            ))
          )}
        </section>
        <p className="analyst-live" role="status" aria-live="polite">
          {live}
        </p>
        {state === "streaming" ? (
          <button type="button" onClick={() => void cancel()}>
            Stop response
          </button>
        ) : state === "failed" || state === "cancelled" ? (
          <button type="button" onClick={retry} disabled={!pendingQuestion}>
            Retry question
          </button>
        ) : null}
        <form
          className="analyst-question"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim()) return;
            setPendingQuestion(question.trim());
            setShowDisclosure(true);
          }}
        >
          <label htmlFor="analyst-question">Your question</label>
          <textarea
            ref={composer}
            className="analyst-textarea--surface"
            id="analyst-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={state === "loading" || state === "streaming"}
            required
          />
          <button
            type="submit"
            className="primary-button"
            disabled={state === "loading" || state === "streaming"}
          >
            Ask Analyst
          </button>
        </form>
      </main>
      {showDisclosure && configuration ? (
        <Disclosure
          configuration={configuration}
          onClose={() => setShowDisclosure(false)}
          onAcknowledge={() => {
            setShowDisclosure(false);
            if (pendingQuestion) void submit(pendingQuestion);
          }}
        />
      ) : null}
      {resetConfirmation ? (
        <Modal titleId="analyst-reset-title" onClose={() => setResetConfirmation(false)}>
          <h2 id="analyst-reset-title">Start a new conversation?</h2>
          <p>
            This removes the current conversation from this page. Shelf Judge does not save Analyst
            conversations.
          </p>
          <div className="analyst-actions">
            <button type="button" onClick={() => setResetConfirmation(false)}>
              Keep conversation
            </button>
            <button type="button" className="primary-button" onClick={reset}>
              Start new conversation
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
