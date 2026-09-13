"use client";

import {
  AnalystConfigurationSchema,
  AnalystFinalSchema,
  AnalystStreamEventSchema,
  type AnalystCitation,
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
  readonly disclosure: { readonly localRetention: string; readonly cancellation: string };
};
type Message = AnalystTurnRequest["messages"][number] & { citations?: AnalystCitation[] };
type LiveState = "idle" | "loading" | "streaming" | "cancelled" | "failed";

const markdownComponents = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
} satisfies Components;

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
  AnalystConfigurationSchema.parse(value);
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

async function readEvents(response: Response, onEvent: (event: AnalystStreamEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The Analyst stream was unavailable.");
  const decoder = new TextDecoder();
  let buffered = "";
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
    }
  }
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
    const transcript = [...priorMessages, owner];
    setMessages(transcript);
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
          disclosure: {
            providerId: configuration.configuration.identity.providerId,
            modelId: configuration.configuration.identity.modelId,
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
  const inspect = async (citation: AnalystCitation) => {
    const response = await fetch("/api/daemon/analyst/citations/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ citation }),
    });
    const result = (await response.json()) as {
      destination?: { operationId: string; parameters: { gameId?: string } };
    };
    if (
      result.destination?.operationId === "shelf.game.get" &&
      result.destination.parameters.gameId
    )
      window.location.assign(`/games/${result.destination.parameters.gameId}`);
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
                        <button type="button" onClick={() => void inspect(citation)}>
                          {citation.testimony ? "Owner testimony" : "Evidence"}:{" "}
                          {citation.canonicalSummary}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
