import { describe, expect, mock, test } from "bun:test";
import {
  benchmarkFormReducer,
  createBenchmarkFormState,
  submitBenchmark,
} from "@/components/entertainment-benchmark-form";

describe("EntertainmentBenchmarkForm", () => {
  test("initializes unknown, configured, and invalid correction states", () => {
    expect(createBenchmarkFormState(null).amount).toBe("");
    expect(
      createBenchmarkFormState({
        state: "configured",
        amount: { hundredths: 800, source: "manual", confirmedAt: "2026-01-01T00:00:00Z" },
      }).amount,
    ).toBe("8.00");
    expect(
      createBenchmarkFormState({
        state: "configured",
        amount: {
          hundredths: 9007199254740990,
          source: "manual",
          confirmedAt: "2026-01-01T00:00:00Z",
        },
      }).amount,
    ).toBe("90071992547409.90");
    expect(
      createBenchmarkFormState({ state: "invalid", evidence: { presence: "missing" } }).amount,
    ).toBe("");
  });

  test("sets or corrects the positive benchmark with exact text", async () => {
    const request = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const refresh = mock(() => undefined);
    let state = createBenchmarkFormState(null);
    const dispatch = (action: Parameters<typeof benchmarkFormReducer>[1]) => {
      state = benchmarkFormReducer(state, action);
    };

    await submitBenchmark({
      amount: "8.00",
      clear: false,
      dispatch,
      refresh,
      request: request as unknown as typeof fetch,
    });

    expect(request.mock.calls[0]?.[0]).toBe("/api/daemon/collection/entertainment-benchmark");
    expect(request.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ amount: "8.00" }));
    expect(state).toMatchObject({ amount: "8.00", saved: true, error: null });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("clears to unknown with DELETE and no body", async () => {
    const request = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await submitBenchmark({
      amount: "8.00",
      clear: true,
      dispatch: () => undefined,
      refresh: () => undefined,
      request: request as unknown as typeof fetch,
    });

    expect(request.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(request.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  test("retains zero or excess-precision text when the daemon rejects it", async () => {
    for (const amount of ["0", "8.001"]) {
      let state = { ...createBenchmarkFormState(null), amount };
      const dispatch = (action: Parameters<typeof benchmarkFormReducer>[1]) => {
        state = benchmarkFormReducer(state, action);
      };
      const request = mock((input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Validation failed" }), { status: 400 }),
        );
      });

      await submitBenchmark({
        amount,
        clear: false,
        dispatch,
        refresh: () => undefined,
        request: request as unknown as typeof fetch,
      });
      expect(state).toMatchObject({ amount, error: "Validation failed", saving: false });
    }
  });

  test("includes the fitness-6 definition and movie-ticket example", async () => {
    const source = await Bun.file(
      "packages/web/components/entertainment-benchmark-form.tsx",
    ).text();
    expect(source).toContain("fitness-6 game");
    expect(source).toContain("$16 / 2 hours = $8 per person-hour");
  });
});
