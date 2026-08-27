import { describe, expect, test } from "bun:test";
import {
  ExactRational,
  compareUnsignedDecimals,
  isCanonicalUnsignedDecimal,
  projectFitnessScore,
} from "../src/exact-rational";

describe("ExactRational", () => {
  test("normalizes signs, common factors, and zero", () => {
    expect(new ExactRational(6n, -8n).toJSON()).toEqual({
      numerator: "-3",
      denominator: "4",
    });
    expect(new ExactRational(0n, -9n).toJSON()).toEqual({ numerator: "0", denominator: "1" });
  });

  test("parses base-10 decimals exactly", () => {
    expect(ExactRational.fromDecimal("7.95").toJSON()).toEqual({
      numerator: "159",
      denominator: "20",
    });
    expect(ExactRational.fromDecimal("-0.125").toJSON()).toEqual({
      numerator: "-1",
      denominator: "8",
    });
    for (const malformed of ["", ".5", "5.", "1e2", " 5", "5 "]) {
      expect(() => ExactRational.fromDecimal(malformed)).toThrow("Invalid exact decimal");
    }
  });

  test("adds, subtracts, multiplies, and divides exactly", () => {
    const oneHalf = new ExactRational(1n, 2n);
    const threeQuarters = new ExactRational(3n, 4n);

    expect(oneHalf.add(threeQuarters).toJSON()).toEqual({ numerator: "5", denominator: "4" });
    expect(oneHalf.subtract(threeQuarters).toJSON()).toEqual({
      numerator: "-1",
      denominator: "4",
    });
    expect(oneHalf.multiply(threeQuarters).toJSON()).toEqual({
      numerator: "3",
      denominator: "8",
    });
    expect(oneHalf.divide(threeQuarters).toJSON()).toEqual({
      numerator: "2",
      denominator: "3",
    });
  });

  test("compares and selects the exact maximum", () => {
    const oneThird = new ExactRational(1n, 3n);
    const decimalThird = ExactRational.fromDecimal("0.333");

    expect(oneThird.compare(decimalThird)).toBe(1);
    expect(decimalThird.compare(oneThird)).toBe(-1);
    expect(oneThird.compare(new ExactRational(2n, 6n))).toBe(0);
    expect(decimalThird.max(oneThird)).toBe(oneThird);
  });

  test("calculates exact ceilings for positive and negative values", () => {
    expect(new ExactRational(4n, 2n).ceiling()).toBe(2n);
    expect(new ExactRational(5n, 2n).ceiling()).toBe(3n);
    expect(new ExactRational(-5n, 2n).ceiling()).toBe(-2n);
  });

  test("rounds half-up at, below, and above a tie", () => {
    expect(ExactRational.fromDecimal("1.499").roundHalfUp()).toBe(1n);
    expect(ExactRational.fromDecimal("1.5").roundHalfUp()).toBe(2n);
    expect(ExactRational.fromDecimal("1.501").roundHalfUp()).toBe(2n);
    expect(ExactRational.fromDecimal("-1.5").roundHalfUp()).toBe(-2n);
  });

  test("throws clear errors for zero denominator and division by zero", () => {
    expect(() => new ExactRational(1n, 0n)).toThrow("denominator cannot be zero");
    expect(() => new ExactRational(1n).divide(new ExactRational(0n))).toThrow(
      "divide an exact rational by zero",
    );
  });

  test("projects JSON without bigint values", () => {
    const rational = new ExactRational(2n, 3n);
    expect(JSON.stringify(rational)).toBe('{"numerator":"2","denominator":"3"}');
  });
});

describe("canonical fitness projection", () => {
  test("produces one decimal from exact base-10 representations", () => {
    expect(projectFitnessScore("0")).toBe("0.0");
    expect(projectFitnessScore("6.2")).toBe("6.2");
    expect(projectFitnessScore("7.94")).toBe("7.9");
    expect(projectFitnessScore("7.95")).toBe("8.0");
    expect(projectFitnessScore("10.00")).toBe("10.0");
    expect(ExactRational.fromDecimal(projectFitnessScore("7.95")).toJSON()).toEqual({
      numerator: "8",
      denominator: "1",
    });
  });
});

describe("canonical unsigned decimals", () => {
  test("accepts only canonical unsigned integer strings", () => {
    for (const valid of ["0", "1", "9007199254740992"]) {
      expect(isCanonicalUnsignedDecimal(valid)).toBe(true);
    }
    for (const invalid of ["", "00", "01", "+1", "-1", "1.0", " 1"]) {
      expect(isCanonicalUnsignedDecimal(invalid)).toBe(false);
    }
  });

  test("compares values above Number.MAX_SAFE_INTEGER without number coercion", () => {
    expect(compareUnsignedDecimals("9007199254740991", "9007199254740992")).toBe(-1);
    expect(compareUnsignedDecimals("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareUnsignedDecimals("10000000000000000", "9999999999999999")).toBe(1);
    expect(compareUnsignedDecimals("9007199254740992", "9007199254740992")).toBe(0);
  });

  test("rejects noncanonical comparator inputs", () => {
    expect(() => compareUnsignedDecimals("01", "1")).toThrow("canonical");
  });
});
