import * as path from "node:path";
import * as os from "node:os";
import { v4 as uuidv4 } from "uuid";
import type { Collection, AppConfig, TournamentData } from "@shelf-judge/shared";
import type { FileOps } from "./file-ops.js";
import { getTempPath } from "./file-ops.js";

export interface StorageService {
  loadCollection(): Promise<Collection>;
  saveCollection(collection: Collection): Promise<void>;
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  loadTournament(): Promise<TournamentData>;
  saveTournament(data: TournamentData): Promise<void>;
}

export interface StorageServiceDeps {
  dataDir: string;
  configPath: string;
  fileOps: FileOps;
}

function createDefaultCollection(): Collection {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name: "My Collection",
    axes: [
      {
        id: uuidv4(),
        name: "Community Rating",
        description: "BGG community average rating",
        weight: 50,
        source: "bgg",
        bggField: "communityRating",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuidv4(),
        name: "Complexity",
        description: "BGG weight normalized to 1-10 scale",
        weight: 50,
        source: "bgg",
        bggField: "weight",
        createdAt: now,
        updatedAt: now,
      },
    ],
    games: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultTournament(): TournamentData {
  return {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400, provisionalThreshold: 6 },
    sessions: [],
    comparisons: [],
    gameStats: {},
  };
}

function defaultConfig(dataDir: string): AppConfig {
  return {
    bggAuthToken: null,
    dataDir,
    socketPath: path.join(os.homedir(), ".shelf-judge", "shelf-judge.sock"),
  };
}

async function atomicWrite(filePath: string, content: string, fileOps: FileOps): Promise<void> {
  const tmpPath = getTempPath(filePath);
  await fileOps.writeFile(tmpPath, content);
  await fileOps.rename(tmpPath, filePath);
}

export function createStorageService(deps: StorageServiceDeps): StorageService {
  const { dataDir, configPath, fileOps } = deps;
  const collectionPath = path.join(dataDir, "collection.json");
  const tournamentPath = path.join(dataDir, "tournament.json");

  return {
    async loadCollection(): Promise<Collection> {
      const exists = await fileOps.exists(collectionPath);
      if (!exists) {
        const collection = createDefaultCollection();
        await fileOps.mkdir(dataDir);
        await atomicWrite(collectionPath, JSON.stringify(collection, null, 2), fileOps);
        return collection;
      }

      const raw = await fileOps.readFile(collectionPath);
      return JSON.parse(raw) as Collection;
    },

    async saveCollection(collection: Collection): Promise<void> {
      await fileOps.mkdir(dataDir);
      await atomicWrite(collectionPath, JSON.stringify(collection, null, 2), fileOps);
    },

    async loadConfig(): Promise<AppConfig> {
      const exists = await fileOps.exists(configPath);
      if (!exists) {
        const config = defaultConfig(dataDir);
        const configDir = path.dirname(configPath);
        await fileOps.mkdir(configDir);
        await atomicWrite(configPath, JSON.stringify(config, null, 2), fileOps);
        return config;
      }

      const raw = await fileOps.readFile(configPath);
      return JSON.parse(raw) as AppConfig;
    },

    async saveConfig(config: AppConfig): Promise<void> {
      const configDir = path.dirname(configPath);
      await fileOps.mkdir(configDir);
      await atomicWrite(configPath, JSON.stringify(config, null, 2), fileOps);
    },

    async loadTournament(): Promise<TournamentData> {
      const exists = await fileOps.exists(tournamentPath);
      if (!exists) {
        const tournament = createDefaultTournament();
        await fileOps.mkdir(dataDir);
        await atomicWrite(tournamentPath, JSON.stringify(tournament, null, 2), fileOps);
        return tournament;
      }

      const raw = await fileOps.readFile(tournamentPath);
      return JSON.parse(raw) as TournamentData;
    },

    async saveTournament(data: TournamentData): Promise<void> {
      await fileOps.mkdir(dataDir);
      await atomicWrite(tournamentPath, JSON.stringify(data, null, 2), fileOps);
    },
  };
}
