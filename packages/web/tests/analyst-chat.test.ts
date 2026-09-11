import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/analyst-chat.tsx", import.meta.url)).text();

describe("Collection Analyst chat", () => {
  test("requires disclosure acknowledgement before a turn can be sent", () => {
    expect(source).toContain("Before sending your question");
    expect(source).toContain("Acknowledge and send");
    expect(source).toContain("relevant collection evidence are sent");
  });

  test("uses daemon stream, cancellation, and citation inspection endpoints", () => {
    expect(source).toContain("/api/daemon/analyst/turns/stream");
    expect(source).toContain("/api/daemon/analyst/turns/cancel");
    expect(source).toContain("/api/daemon/analyst/citations/inspect");
    expect(source).toContain("AnalystStreamEventSchema.safeParse");
    expect(source).toContain("AnalystFinalSchema.parse");
    expect(source).toContain("noteDependencies: event.noteDependencies");
    expect(source).toContain("crypto.getRandomValues(bytes)");
    expect(source).toContain("new Uint8Array(32)");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("request.controller.abort()");
  });

  test("keeps state ephemeral, guards stale stream events, retries safely, and confirms reset", () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).toContain("active.current?.requestId !== event.requestId");
    expect(source).toContain('messages.at(-1)?.role === "owner"');
    expect(source).toContain("Start a new conversation?");
    expect(source).toContain("Nothing was saved");
  });

  test("has labelled controls and live announcements", () => {
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-label="Analyst conversation"');
    expect(source).toContain('htmlFor="analyst-question"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain("inert={showDisclosure || resetConfirmation}");
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("ref={composer}");
  });
});
