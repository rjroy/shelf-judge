import { ExactRational } from "./exact-rational";

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX_SAFE_HUNDREDTHS = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO = new ExactRational(0n);

export function parseAmountInput(input: string): number {
  const match = AMOUNT_PATTERN.exec(input);
  if (match === null) {
    throw new Error("Amount must be an unsigned decimal with at most two fractional digits");
  }

  const [, whole, fractional = ""] = match;
  const hundredths = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0") || "0");
  if (hundredths > MAX_SAFE_HUNDREDTHS) {
    throw new Error("Amount exceeds the maximum safe stored hundredths");
  }

  return Number(hundredths);
}

export function formatStoredAmount(hundredths: number): string {
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) {
    throw new Error("Stored amount must be a non-negative safe integer number of hundredths");
  }

  return formatExactAmount(new ExactRational(BigInt(hundredths)));
}

export function formatExactAmount(hundredths: ExactRational): string {
  if (hundredths.compare(ZERO) < 0) {
    throw new Error("Exact amount cannot be negative");
  }

  const roundedHundredths = hundredths.roundHalfUp();
  if (roundedHundredths === 0n && hundredths.compare(ZERO) > 0) {
    return "<$0.01";
  }

  const whole = roundedHundredths / 100n;
  const fractional = (roundedHundredths % 100n).toString().padStart(2, "0");
  return `$${whole}.${fractional}`;
}

export function amountSortKey(hundredths: ExactRational): string {
  if (hundredths.compare(ZERO) < 0) {
    throw new Error("Exact amount sort value cannot be negative");
  }

  return hundredths.roundHalfUp().toString();
}
