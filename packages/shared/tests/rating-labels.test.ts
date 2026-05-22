import { describe, expect, test } from "bun:test";
import { getRatingLabel } from "../src/rating-labels";

describe("getRatingLabel — integer inputs", () => {
  test("1 → Offensive", () => expect(getRatingLabel(1)).toBe("Offensive"));
  test("2 → Inexplicable", () => expect(getRatingLabel(2)).toBe("Inexplicable"));
  test("3 → Just Bad", () => expect(getRatingLabel(3)).toBe("Just Bad"));
  test("4 → Not Good", () => expect(getRatingLabel(4)).toBe("Not Good"));
  test("5 → Fine", () => expect(getRatingLabel(5)).toBe("Fine"));
  test("6 → Good", () => expect(getRatingLabel(6)).toBe("Good"));
  test("7 → Very Good", () => expect(getRatingLabel(7)).toBe("Very Good"));
  test("8 → Recommended", () => expect(getRatingLabel(8)).toBe("Recommended"));
  test("9 → Definitive", () => expect(getRatingLabel(9)).toBe("Definitive"));
  test("10 → Essential", () => expect(getRatingLabel(10)).toBe("Essential"));
});

describe("getRatingLabel — decimal rounding", () => {
  test("5.4 rounds to 5 → Fine", () => expect(getRatingLabel(5.4)).toBe("Fine"));
  test("5.5 rounds to 6 → Good", () => expect(getRatingLabel(5.5)).toBe("Good"));
  test("5.8 rounds to 6 → Good", () => expect(getRatingLabel(5.8)).toBe("Good"));
  test("5.9 rounds to 6 → Good", () => expect(getRatingLabel(5.9)).toBe("Good"));
  test("6.3 rounds to 6 → Good", () => expect(getRatingLabel(6.3)).toBe("Good"));
  test("7.3 rounds to 7 → Very Good", () => expect(getRatingLabel(7.3)).toBe("Very Good"));
  test("8.7 rounds to 9 → Definitive", () => expect(getRatingLabel(8.7)).toBe("Definitive"));
});

describe("getRatingLabel — null input", () => {
  test("null → null", () => expect(getRatingLabel(null)).toBeNull());
});

describe("getRatingLabel — out-of-range inputs", () => {
  test("0 → null", () => expect(getRatingLabel(0)).toBeNull());
  test("0.4 rounds to 0 → null", () => expect(getRatingLabel(0.4)).toBeNull());
  test("10.5 rounds to 11 → null", () => expect(getRatingLabel(10.5)).toBeNull());
  test("11 → null", () => expect(getRatingLabel(11)).toBeNull());
  test("-1 → null", () => expect(getRatingLabel(-1)).toBeNull());
});
