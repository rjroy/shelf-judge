import { expect, test } from "bun:test";
import { abortRace } from "../../src/services/reflection-refresh-service.js";

test("cancellation wins while reflection evidence finishing is still pending", async () => {
  let resolveFinish: ((value: string) => void) | undefined;
  const finish = new Promise<string>((resolve) => {
    resolveFinish = resolve;
  });
  const controller = new AbortController();
  const raced = abortRace(finish, controller.signal);

  controller.abort();

  await raced.then(
    () => expect.unreachable("cancellation must reject the finishing race"),
    (error: unknown) => expect(error).toMatchObject({ name: "AbortError" }),
  );
  resolveFinish?.("late evidence must not be published");
});
