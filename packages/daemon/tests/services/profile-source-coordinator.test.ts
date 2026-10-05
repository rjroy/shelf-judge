import { describe, expect, test } from "bun:test";
import {
  profileSourceCoordinatorFor,
  runOutsideProfileSourceCoordinator,
  type ProfileSourceCoordinator,
} from "../../src/services/profile-source-coordinator.js";

describe("profile source coordinator reentrancy context", () => {
  test("reports only the exact current coordinator across awaits and outside contexts", async () => {
    const storageA = {};
    const storageB = {};
    const coordinatorA = profileSourceCoordinatorFor(storageA);
    const coordinatorB = profileSourceCoordinatorFor(storageB);
    const baseContract: ProfileSourceCoordinator = {
      runExclusive: (operation) => coordinatorA.runExclusive(operation),
    };

    expect(coordinatorA.isHeldByCurrentContext()).toBe(false);
    await coordinatorA.runExclusive(async () => {
      expect(coordinatorA.isHeldByCurrentContext()).toBe(true);
      expect(coordinatorB.isHeldByCurrentContext()).toBe(false);
      await Promise.resolve();
      expect(coordinatorA.isHeldByCurrentContext()).toBe(true);
      runOutsideProfileSourceCoordinator(() => {
        expect(coordinatorA.isHeldByCurrentContext()).toBe(false);
      });
      await coordinatorB.runExclusive(async () => {
        expect(coordinatorA.isHeldByCurrentContext()).toBe(false);
        expect(coordinatorB.isHeldByCurrentContext()).toBe(true);
        await Promise.resolve();
      });
      expect(coordinatorA.isHeldByCurrentContext()).toBe(true);
    });
    expect(coordinatorA.isHeldByCurrentContext()).toBe(false);
    // Existing attention/reflection test doubles remain valid against the base interface.
    await baseContract.runExclusive(async () => {});
  });
});
