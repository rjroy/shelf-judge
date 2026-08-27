import { describe, expect, test } from "bun:test";
import {
  amountSortKey,
  formatExactAmount,
  formatStoredAmount,
  parseAmountInput,
} from "../src/amount";
import { ExactRational } from "../src/exact-rational";

describe("parseAmountInput", () => {
  test("accepts zero, one, and two fractional digits without rounding", () => {
    expect(parseAmountInput("0")).toBe(0);
    expect(parseAmountInput("5")).toBe(500);
    expect(parseAmountInput("5.0")).toBe(500);
    expect(parseAmountInput("5.00")).toBe(500);
    expect(parseAmountInput("0.01")).toBe(1);
  });

  test("accepts the maximum safe stored hundredths and rejects overflow", () => {
    expect(parseAmountInput("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseAmountInput("90071992547409.92")).toThrow("maximum safe");
    expect(() => parseAmountInput("90071992547410")).toThrow("maximum safe");
  });

  test("rejects signs, malformed syntax, and excess precision", () => {
    for (const invalid of [
      "-1",
      "+1",
      "1.001",
      "1.",
      ".50",
      "1e2",
      "NaN",
      "Infinity",
      " 1",
      "1 ",
      "",
    ]) {
      expect(() => parseAmountInput(invalid)).toThrow("unsigned decimal");
    }
  });

  test("does not impose benchmark positivity on generic amounts", () => {
    expect(parseAmountInput("0.00")).toBe(0);
  });
});

describe("amount display", () => {
  test("formats stored integer hundredths with exactly two decimal places", () => {
    expect(formatStoredAmount(0)).toBe("$0.00");
    expect(formatStoredAmount(1)).toBe("$0.01");
    expect(formatStoredAmount(500)).toBe("$5.00");
    expect(formatStoredAmount(Number.MAX_SAFE_INTEGER)).toBe("$90071992547409.91");
  });

  test("distinguishes exact zero from a positive sub-cent amount", () => {
    expect(formatExactAmount(new ExactRational(0n))).toBe("$0.00");
    expect(formatExactAmount(new ExactRational(1n, 100n))).toBe("<$0.01");
  });

  test("pins display and sort keys below, at, and above $0.005", () => {
    const below = new ExactRational(499n, 1000n);
    const at = new ExactRational(1n, 2n);
    const above = new ExactRational(501n, 1000n);

    expect(formatExactAmount(below)).toBe("<$0.01");
    expect(amountSortKey(below)).toBe("0");
    expect(formatExactAmount(at)).toBe("$0.01");
    expect(amountSortKey(at)).toBe("1");
    expect(formatExactAmount(above)).toBe("$0.01");
    expect(amountSortKey(above)).toBe("1");
  });

  test("rejects invalid stored and negative derived amounts", () => {
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatStoredAmount(invalid)).toThrow("non-negative safe integer");
    }
    expect(() => formatExactAmount(new ExactRational(-1n))).toThrow("cannot be negative");
    expect(() => amountSortKey(new ExactRational(-1n))).toThrow("cannot be negative");
  });
});
