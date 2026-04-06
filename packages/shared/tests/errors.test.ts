import { describe, expect, test } from "bun:test";
import { toErrorMessage } from "../src/errors.js";

describe("toErrorMessage", () => {
  test("extracts message from Error instance", () => {
    expect(toErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  test("extracts message from Error subclass", () => {
    expect(toErrorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  test("converts string to itself", () => {
    expect(toErrorMessage("raw string")).toBe("raw string");
  });

  test("converts number to string", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  test("converts null to string", () => {
    expect(toErrorMessage(null)).toBe("null");
  });

  test("converts undefined to string", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  test("converts object to string", () => {
    expect(toErrorMessage({ key: "value" })).toBe("[object Object]");
  });
});
