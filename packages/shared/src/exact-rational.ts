export interface ExactRationalJson {
  numerator: string;
  denominator: string;
}

export type ExactComparison = -1 | 0 | 1;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/;

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;

  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

function powerOfTen(decimalPlaces: number): bigint {
  if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new Error("Decimal places must be a non-negative safe integer");
  }

  return 10n ** BigInt(decimalPlaces);
}

export class ExactRational {
  readonly #numerator: bigint;
  readonly #denominator: bigint;

  constructor(numerator: bigint, denominator = 1n) {
    if (denominator === 0n) {
      throw new Error("Exact rational denominator cannot be zero");
    }

    const sign = denominator < 0n ? -1n : 1n;
    const divisor = greatestCommonDivisor(numerator, denominator);
    this.#numerator = (numerator / divisor) * sign;
    this.#denominator = (denominator / divisor) * sign;
  }

  static fromDecimal(value: string): ExactRational {
    const match = DECIMAL_PATTERN.exec(value);
    if (match === null) {
      throw new Error(`Invalid exact decimal: ${value}`);
    }

    const [, sign, whole, fractional = "", exponentText = "0"] = match;
    const exponent = Number(exponentText);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
      throw new Error(`Exact decimal exponent is out of range: ${value}`);
    }
    const magnitude = BigInt(`${whole}${fractional}`);
    const scale = fractional.length - exponent;
    const numerator = scale < 0 ? magnitude * powerOfTen(-scale) : magnitude;
    const denominator = scale > 0 ? powerOfTen(scale) : 1n;
    return new ExactRational(sign === "-" ? -numerator : numerator, denominator);
  }

  add(other: ExactRational): ExactRational {
    return new ExactRational(
      this.#numerator * other.#denominator + other.#numerator * this.#denominator,
      this.#denominator * other.#denominator,
    );
  }

  subtract(other: ExactRational): ExactRational {
    return new ExactRational(
      this.#numerator * other.#denominator - other.#numerator * this.#denominator,
      this.#denominator * other.#denominator,
    );
  }

  multiply(other: ExactRational): ExactRational {
    return new ExactRational(
      this.#numerator * other.#numerator,
      this.#denominator * other.#denominator,
    );
  }

  divide(other: ExactRational): ExactRational {
    if (other.#numerator === 0n) {
      throw new Error("Cannot divide an exact rational by zero");
    }

    return new ExactRational(
      this.#numerator * other.#denominator,
      this.#denominator * other.#numerator,
    );
  }

  compare(other: ExactRational): ExactComparison {
    const difference = this.#numerator * other.#denominator - other.#numerator * this.#denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  max(other: ExactRational): ExactRational {
    return this.compare(other) >= 0 ? this : other;
  }

  ceiling(): bigint {
    const quotient = this.#numerator / this.#denominator;
    return this.#numerator > 0n && this.#numerator % this.#denominator !== 0n
      ? quotient + 1n
      : quotient;
  }

  roundHalfUp(decimalPlaces = 0): bigint {
    const scale = powerOfTen(decimalPlaces);
    const scaledNumerator = this.#numerator * scale;
    const magnitude = scaledNumerator < 0n ? -scaledNumerator : scaledNumerator;
    let rounded = magnitude / this.#denominator;

    if ((magnitude % this.#denominator) * 2n >= this.#denominator) {
      rounded += 1n;
    }

    return scaledNumerator < 0n ? -rounded : rounded;
  }

  formatFixed(decimalPlaces: number): string {
    const scale = powerOfTen(decimalPlaces);
    const rounded = this.roundHalfUp(decimalPlaces);
    const sign = rounded < 0n ? "-" : "";
    const magnitude = rounded < 0n ? -rounded : rounded;

    if (decimalPlaces === 0) {
      return `${sign}${magnitude}`;
    }

    const whole = magnitude / scale;
    const fractional = (magnitude % scale).toString().padStart(decimalPlaces, "0");
    return `${sign}${whole}.${fractional}`;
  }

  toNumber(): number {
    if (this.#numerator === 0n) return 0;

    const negative = this.#numerator < 0n;
    const numerator = negative ? -this.#numerator : this.#numerator;
    const denominator = this.#denominator;
    let exponent = numerator.toString().length - denominator.toString().length;
    const belowExponent =
      exponent >= 0
        ? numerator < denominator * powerOfTen(exponent)
        : numerator * powerOfTen(-exponent) < denominator;
    if (belowExponent) exponent -= 1;

    const precision = 18;
    const scale = precision - 1 - exponent;
    const scaledNumerator = scale >= 0 ? numerator * powerOfTen(scale) : numerator;
    const scaledDenominator = scale >= 0 ? denominator : denominator * powerOfTen(-scale);
    let significant = scaledNumerator / scaledDenominator;
    if ((scaledNumerator % scaledDenominator) * 2n >= scaledDenominator) significant += 1n;
    const precisionLimit = powerOfTen(precision);
    if (significant === precisionLimit) {
      significant /= 10n;
      exponent += 1;
    }
    const digits = significant.toString().padStart(precision, "0");
    return Number(`${negative ? "-" : ""}${digits[0]}.${digits.slice(1)}e${exponent}`);
  }

  toJSON(): ExactRationalJson {
    return {
      numerator: this.#numerator.toString(),
      denominator: this.#denominator.toString(),
    };
  }
}

export function projectFitnessScore(baseTenScore: string): string {
  return ExactRational.fromDecimal(baseTenScore).formatFixed(1);
}

export function isCanonicalUnsignedDecimal(value: string): boolean {
  return UNSIGNED_DECIMAL_PATTERN.test(value);
}

export function compareUnsignedDecimals(left: string, right: string): ExactComparison {
  if (!isCanonicalUnsignedDecimal(left) || !isCanonicalUnsignedDecimal(right)) {
    throw new Error("Unsigned decimal values must be canonical non-negative integers");
  }

  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }

  return left < right ? -1 : left > right ? 1 : 0;
}
