import { describe, expect, mock, test } from "bun:test";
import {
  acquisitionFormReducer,
  createAcquisitionFormState,
  submitAcquisition,
  type AcquisitionFormState,
} from "@/components/acquisition-form";

describe("AcquisitionForm", () => {
  test("initializes unknown, gift, purchase, and invalid correction states", () => {
    expect(createAcquisitionFormState({ state: "unknown" })).toMatchObject({
      selectedState: "unknown",
      amount: "",
    });
    expect(createAcquisitionFormState({ state: "gift" }).selectedState).toBe("gift");
    expect(
      createAcquisitionFormState({
        state: "purchase",
        amount: { hundredths: 1234, source: "manual", confirmedAt: "2026-01-01T00:00:00Z" },
      }),
    ).toMatchObject({ selectedState: "purchase", amount: "12.34" });
    expect(
      createAcquisitionFormState({
        state: "purchase",
        amount: {
          hundredths: 9007199254740990,
          source: "manual",
          confirmedAt: "2026-01-01T00:00:00Z",
        },
      }).amount,
    ).toBe("90071992547409.90");
    expect(
      createAcquisitionFormState({ state: "invalid", evidence: { presence: "missing" } })
        .selectedState,
    ).toBe("unknown");
  });

  test("sends purchase text unchanged and refreshes after success", async () => {
    let state = createAcquisitionFormState({ state: "unknown" });
    state = acquisitionFormReducer(state, { type: "select", state: "purchase" });
    state = acquisitionFormReducer(state, { type: "amount", amount: "0.00" });
    const dispatch = (action: Parameters<typeof acquisitionFormReducer>[1]) => {
      state = acquisitionFormReducer(state, action);
    };
    const request = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const refresh = mock(() => undefined);

    await submitAcquisition({
      gameId: "game-1",
      state: state.selectedState,
      amount: state.amount,
      dispatch,
      refresh,
      request: request as unknown as typeof fetch,
    });

    expect(request.mock.calls[0]?.[0]).toBe("/api/daemon/games/game-1/acquisition");
    expect(request.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(request.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ state: "purchase", amount: "0.00" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("preserves entered text and exposes daemon mutation failures", async () => {
    let state: AcquisitionFormState = {
      ...createAcquisitionFormState({ state: "unknown" }),
      selectedState: "purchase" as const,
      amount: "12.345",
    };
    const dispatch = (action: Parameters<typeof acquisitionFormReducer>[1]) => {
      state = acquisitionFormReducer(state, action);
    };
    const request = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Validation failed" }), { status: 400 }),
      );
    });

    await submitAcquisition({
      gameId: "game-1",
      state: state.selectedState,
      amount: state.amount,
      dispatch,
      refresh: () => undefined,
      request: request as unknown as typeof fetch,
    });

    expect(state).toMatchObject({ amount: "12.345", saving: false, error: "Validation failed" });
  });

  test("uses strict amount-free payloads for gift and unknown", async () => {
    for (const selectedState of ["gift", "unknown"] as const) {
      const request = mock((input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      });
      await submitAcquisition({
        gameId: "game-1",
        state: selectedState,
        amount: "99.00",
        dispatch: () => undefined,
        refresh: () => undefined,
        request: request as unknown as typeof fetch,
      });
      expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ state: selectedState }));
    }
  });
});
