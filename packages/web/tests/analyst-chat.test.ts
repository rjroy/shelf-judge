import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/analyst-chat.tsx", import.meta.url)).text();
const fixture = await Bun.file(new URL("../e2e/fixture-daemon.ts", import.meta.url)).text();

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

  test("uses safe, reason-specific failure guidance and never surfaces caught provider errors", () => {
    expect(source).toContain("function failureGuidance");
    expect(source).toContain('case "authentication"');
    expect(source).toContain('case "evidence-load"');
    expect(source).toContain('case "output-validation"');
    expect(source).toContain("The Analyst took too long to respond.");
    expect(source).not.toContain("setLive(error instanceof Error ? error.message");
  });

  test("renders discovery and preview as daemon-authored ephemeral views", () => {
    expect(source).toContain('aria-label={title ? "BGG title matches" : "BGG Hot sample"}');
    expect(source).toContain("No matches in this title search.");
    expect(source).toContain("Showing a bounded sample; more results were returned.");
    expect(source).toContain('"Predicted fitness"');
    expect(source).toContain('"Existing in collection"');
    expect(source).toContain("Identity is ambiguous");
    expect(source).toContain("Read-only preview. Nothing was added or changed.");
    expect(source).not.toMatch(/fetch\([^)]*predictions\/bgg/);
    expect(source).not.toMatch(/fetch\([^)]*boardgamegeek\.com/);
    expect(source).not.toContain("Pin ID for follow-up");
    expect(source).not.toContain("Pinned for follow-up");
    expect(source).not.toContain("Discovery receipts");
  });

  test("validates fixture turn and citation-inspection requests against strict contracts", () => {
    expect(fixture).toContain("AnalystTurnRequestSchema.safeParse(requestBody)");
    expect(fixture).toContain("AnalystCitationInspectRequestSchema.safeParse(await body(request))");
    expect(fixture).toContain('return json({ error: "Invalid Analyst turn request" }, 400)');
    expect(fixture).toContain('return json({ error: "Invalid citation inspection request" }, 400)');
  });
});
