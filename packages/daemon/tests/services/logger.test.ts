import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { createLogger } from "../../src/services/logger.js";

describe("createLogger", () => {
  const logSpy = spyOn(console, "log");
  const warnSpy = spyOn(console, "warn");
  const errorSpy = spyOn(console, "error");

  afterEach(() => {
    logSpy.mockReset();
    warnSpy.mockReset();
    errorSpy.mockReset();
  });

  test("log delegates to console.log with prefix", () => {
    const logger = createLogger("test");
    logger.log("hello");
    expect(logSpy).toHaveBeenCalledWith("[test]", "hello");
  });

  test("warn delegates to console.warn with prefix", () => {
    const logger = createLogger("test");
    logger.warn("caution");
    expect(warnSpy).toHaveBeenCalledWith("[test]", "caution");
  });

  test("error delegates to console.error with prefix", () => {
    const logger = createLogger("test");
    logger.error("failure");
    expect(errorSpy).toHaveBeenCalledWith("[test]", "failure");
  });

  test("passes multiple arguments through", () => {
    const logger = createLogger("multi");
    logger.log("a", 42, { x: 1 });
    expect(logSpy).toHaveBeenCalledWith("[multi]", "a", 42, '{"x":1}');
  });

  test("serializes nested diagnostics without console inspection truncation", () => {
    const logger = createLogger("grounded-analysis");
    logger.error("grounded analysis rejected", {
      outcome: "failed",
      toolLifecycle: [
        {
          toolName: "submit_grounded_analysis",
          arguments: { evidenceIdentityHash: "b8b701186e6f30e8" },
          result: { accepted: false, reason: "validation-rejected" },
        },
      ],
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[grounded-analysis]",
      "grounded analysis rejected",
      '{"outcome":"failed","toolLifecycle":[{"toolName":"submit_grounded_analysis","arguments":{"evidenceIdentityHash":"b8b701186e6f30e8"},"result":{"accepted":false,"reason":"validation-rejected"}}]}',
    );
  });

  test("keeps error diagnostics informative", () => {
    const logger = createLogger("test");
    const error = new Error("session unavailable");
    logger.error("grounded analysis failed", error);

    const output = errorSpy.mock.calls[0];
    expect(output).toEqual([
      "[test]",
      "grounded analysis failed",
      expect.stringContaining('"message":"session unavailable"'),
    ]);
    expect(output?.[2]).toEqual(expect.stringContaining('"stack":'));
  });

  test("preserves error details when its cause is circular", () => {
    const logger = createLogger("test");
    const error = new Error("circular error");
    error.cause = error;
    logger.error("grounded analysis failed", error);

    expect(errorSpy).toHaveBeenCalledWith(
      "[test]",
      "grounded analysis failed",
      expect.stringContaining('"name":"Error"'),
    );
    expect(errorSpy.mock.calls[0]?.[2]).toEqual(
      expect.stringContaining('"message":"circular error"'),
    );
    expect(errorSpy.mock.calls[0]?.[2]).toEqual(expect.stringContaining('"stack":'));
    expect(errorSpy.mock.calls[0]?.[2]).toEqual(expect.stringContaining('"cause":"[Circular]"'));
  });

  test("uses the provided name as prefix", () => {
    const logger = createLogger("bgg");
    logger.log("fetch started");
    expect(logSpy).toHaveBeenCalledWith("[bgg]", "fetch started");
  });
});
