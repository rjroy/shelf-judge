import type { DaemonClient } from "../client.js";
import type { EntertainmentBenchmark } from "@shelf-judge/shared";
import { formatStoredAmount } from "@shelf-judge/shared";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";

interface BenchmarkResponse {
  entertainmentBenchmark: EntertainmentBenchmark;
}

function formatBenchmark(response: BenchmarkResponse): string {
  const benchmark = response.entertainmentBenchmark;
  if (benchmark === null) {
    return "Collection entertainment benchmark is unknown.";
  }
  if (benchmark.state === "invalid") {
    return "Collection entertainment benchmark is invalid and can be corrected or cleared to unknown.";
  }
  return `Collection entertainment benchmark: ${formatStoredAmount(benchmark.amount.hundredths)} per person-hour at fitness 6.`;
}

export async function collectionBenchmark(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [action, amount, ...extra] = args;
  const validShape =
    extra.length === 0 &&
    ((action === "get" && amount === undefined) ||
      (action === "set" && amount !== undefined) ||
      (action === "clear" && amount === undefined));
  if (!validShape) {
    throw new Error("Usage: shelf-judge collection benchmark get|set [amount]|clear");
  }

  const path = "/api/collection/entertainment-benchmark";
  const response =
    action === "get"
      ? await client.get<BenchmarkResponse>(path)
      : action === "set"
        ? await client.put<BenchmarkResponse>(path, { amount })
        : await client.del<BenchmarkResponse>(path);
  if (!response.ok) {
    const error = response.data as unknown as { error?: string };
    throw new Error(error.error ?? "Entertainment benchmark command failed");
  }
  if (opts.json) return printOutput(response.data, opts);
  if (action === "clear") {
    return "Collection entertainment benchmark cleared to unknown.";
  }
  return formatBenchmark(response.data);
}
