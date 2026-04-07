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
    expect(logSpy).toHaveBeenCalledWith("[multi]", "a", 42, { x: 1 });
  });

  test("uses the provided name as prefix", () => {
    const logger = createLogger("bgg");
    logger.log("fetch started");
    expect(logSpy).toHaveBeenCalledWith("[bgg]", "fetch started");
  });
});
