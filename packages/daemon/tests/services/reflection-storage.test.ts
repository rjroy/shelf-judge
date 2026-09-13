import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REFLECTION_SETTINGS,
  ReflectionSettingsSchema,
  type ReflectionSettings,
} from "@shelf-judge/shared";
import {
  REFLECTION_SETTINGS_STAGE_PREFIX,
  REFLECTION_SETTINGS_FILE,
  REFLECTION_STAGE_PREFIX,
  REFLECTION_STATE_FILE,
  createReflectionStorage,
  isReflectionOrphanArtifact,
} from "../../src/services/reflection-storage.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

const DATA_DIR = "/test/data";
const SETTINGS_PATH = `${DATA_DIR}/${REFLECTION_SETTINGS_FILE}`;
const STATE_PATH = `${DATA_DIR}/${REFLECTION_STATE_FILE}`;
const GENERATIONS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const TRANSACTION_ID = "33000000-0000-4000-8000-000000000001";
const TEMP_TOKEN = "44000000-0000-4000-8000-000000000001";
const SHA256 = "a".repeat(64);
const STATE_STAGE = `${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${SHA256}.json`;
const SETTINGS_STAGE = `${REFLECTION_SETTINGS_STAGE_PREFIX}${TRANSACTION_ID}.${SHA256}.json`;

function setup(initialFiles: Record<string, string> = {}) {
  const fileOps = createMockFileOps(initialFiles);
  let generation = 0;
  const storage = createReflectionStorage({
    dataDir: DATA_DIR,
    fileOps,
    createGeneration: () => GENERATIONS[generation++] ?? crypto.randomUUID(),
    temporaryPathForAttempt: (filePath, attempt) => `${filePath}.${attempt}.tmp`,
    logger: { log() {}, warn() {}, error() {} },
  });
  return { fileOps, storage };
}

function defaultSettings(): ReflectionSettings {
  return ReflectionSettingsSchema.parse(structuredClone(DEFAULT_REFLECTION_SETTINGS));
}

describe("Reflection storage", () => {
  test.each([
    [STATE_STAGE, true],
    [SETTINGS_STAGE, true],
    [`.${STATE_STAGE}.${TEMP_TOKEN}.tmp`, true],
    [`.${SETTINGS_STAGE}.${TEMP_TOKEN}.tmp`, true],
    [`.${REFLECTION_STATE_FILE}.${TEMP_TOKEN}.tmp`, true],
    [`.${REFLECTION_SETTINGS_FILE}.${TEMP_TOKEN}.tmp`, true],
    [".profile-reflections.stage.user-backup", false],
    [".profile-reflection-settings.stage.user-backup", false],
    [`${REFLECTION_STAGE_PREFIX}not-a-uuid.${SHA256}.json`, false],
    [`${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${"a".repeat(63)}.json`, false],
    [`${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${"g".repeat(64)}.json`, false],
    [`${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${SHA256}.JSON`, false],
    [`${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${SHA256}.json.backup`, false],
    [`${REFLECTION_STAGE_PREFIX}${TRANSACTION_ID}.${SHA256}.extra.json`, false],
    [`.${STATE_STAGE}.not-a-random-token.tmp`, false],
    [`.${STATE_STAGE}.00000000-0000-0000-0000-000000000000.tmp`, false],
    [`.${STATE_STAGE}.44000000-0000-1000-8000-000000000001.tmp`, false],
    [`.${REFLECTION_STATE_FILE}.not-a-random-token.tmp`, false],
    [`.${REFLECTION_STATE_FILE}.${TEMP_TOKEN}.tmp.backup`, false],
    [`.profile-reflections.json.backup.${TEMP_TOKEN}.tmp`, false],
    [`nested/${STATE_STAGE}`, false],
    [`nested\\${STATE_STAGE}`, false],
    [`../${STATE_STAGE}`, false],
    [`.unrelated.${TEMP_TOKEN}.tmp`, false],
  ])("classifies exact owned orphan artifact %s as %s", (fileName, expected) => {
    expect(isReflectionOrphanArtifact(fileName)).toBe(expected);
  });

  test("creates and round-trips separately versioned settings and note-bearing state", async () => {
    const { fileOps, storage } = setup();
    const settings = await storage.loadSettings();
    const state = await storage.loadState();

    expect(settings).toEqual(defaultSettings());
    expect(state.deletionGeneration).toBe(GENERATIONS[0]);
    expect(fileOps.files.has(SETTINGS_PATH)).toBe(true);
    expect(fileOps.files.has(STATE_PATH)).toBe(true);

    settings.questions[0].enabled = false;
    state.questions[1].attempt = {
      state: "unavailable",
      reason: "provider-outage",
      occurredAt: "2026-08-31T12:00:00.000Z",
    };
    await storage.saveSettings(settings);
    await storage.saveState(state);

    expect(await storage.loadSettings()).toEqual(settings);
    expect(await storage.loadState()).toEqual(state);
  });

  test("destroys corrupt and unknown-version state without quarantine while preserving settings", async () => {
    for (const rawState of ["not json", JSON.stringify({ version: 99 })]) {
      const validSettings = defaultSettings();
      validSettings.questions[0].enabled = false;
      const { fileOps, storage } = setup({
        [SETTINGS_PATH]: JSON.stringify(validSettings),
        [STATE_PATH]: rawState,
      });

      expect(await storage.loadSettings()).toEqual(validSettings);
      const rebuilt = await storage.loadState();
      expect(rebuilt.deletionGeneration).toBe(GENERATIONS[0]);
      expect(rebuilt.questions.every(({ cache }) => cache === null)).toBe(true);
      expect([...fileOps.files.keys()].some((file) => file.includes("quarantine"))).toBe(false);
      expect(fileOps.files.get(STATE_PATH)).not.toBe(rawState);
      expect(await storage.loadSettings()).toEqual(validSettings);
    }
  });

  test("destroys invalid settings independently and resets all questions to enabled", async () => {
    const { fileOps, storage } = setup({
      [SETTINGS_PATH]: JSON.stringify({ version: 99, ownerText: "must not survive" }),
    });

    expect(await storage.loadSettings()).toEqual(defaultSettings());
    expect(fileOps.files.get(SETTINGS_PATH)).not.toContain("must not survive");
    expect([...fileOps.files.keys()].some((file) => file.includes("quarantine"))).toBe(false);
  });

  test("logs only text-free corruption diagnostics", async () => {
    const privateText = "private owner-derived reflection";
    const fileOps = createMockFileOps({ [STATE_PATH]: `{${privateText}` });
    const messages: string[] = [];
    const storage = createReflectionStorage({
      dataDir: DATA_DIR,
      fileOps,
      createGeneration: () => GENERATIONS[0],
      logger: {
        log: (...values) => messages.push(values.join(" ")),
        warn: (...values) => messages.push(values.join(" ")),
        error: (...values) => messages.push(values.join(" ")),
      },
    });

    await storage.loadState();
    expect(messages.join("\n")).not.toContain(privateText);
  });

  test("propagates transient reads without destroying valid artifacts", async () => {
    const validSettings = JSON.stringify(defaultSettings());
    const { fileOps, storage } = setup({ [SETTINGS_PATH]: validSettings });
    fileOps.readFile = () => Promise.reject(new Error("temporary read failure"));

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
    await expect(storage.loadSettings()).rejects.toThrow("temporary read failure");
    expect(fileOps.files.get(SETTINGS_PATH)).toBe(validSettings);
    expect(fileOps.calls.some(({ method }) => method === "unlink")).toBe(false);
  });

  test("leaves the prior artifact intact and removes temporary content after an interrupted rename", async () => {
    const { fileOps, storage } = setup();
    const prior = await storage.loadState();
    const priorRaw = fileOps.files.get(STATE_PATH);
    const originalRename = fileOps.rename.bind(fileOps);
    fileOps.rename = (oldPath, newPath) =>
      newPath === STATE_PATH
        ? Promise.reject(new Error("injected interruption"))
        : originalRename(oldPath, newPath);

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects is thenable
    await expect(
      storage.saveState({ ...prior, deletionGeneration: GENERATIONS[1] }),
    ).rejects.toThrow("injected interruption");

    expect(fileOps.files.get(STATE_PATH)).toBe(priorRaw);
    expect([...fileOps.files.keys()].some((file) => file.endsWith(".tmp"))).toBe(false);
  });
});
