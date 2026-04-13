#!/usr/bin/env bun
// shelf-judge CLI entry point.
// Parses arguments, checks daemon reachability, dispatches to command handlers.

import { toErrorMessage } from "@shelf-judge/shared";
import { createDaemonClient } from "./client.js";
import {
  gameSearch,
  gameAdd,
  gameList,
  gameRate,
  gameRemove,
  gameRefreshAllBgg,
  gameSetStatus,
} from "./commands/game.js";
import { axisList, axisCreate, axisUpdate, axisDelete } from "./commands/axis.js";
import { scoreList, scoreGet } from "./commands/score.js";
import { importBggCollection } from "./commands/import.js";
import { configGet, configSet } from "./commands/config.js";
import { daemonStart, daemonStop } from "./commands/daemon.js";
import { helpCommand } from "./commands/help.js";
import {
  tournamentStart,
  tournamentNext,
  tournamentPick,
  tournamentStop,
  tournamentStats,
} from "./commands/tournament.js";
import { profileCommand, profileNarrateCommand } from "./commands/profile.js";
import { predictGame, predictBggGame, predictReadiness } from "./commands/predict.js";
import { nicheIgnored, nicheIgnore, nicheUnignore } from "./commands/niche.js";
import {
  wishlistList,
  wishlistAdd,
  wishlistRemove,
  wishlistClear,
  wishlistRefresh,
} from "./commands/wishlist.js";
import {
  redundancySettings,
  redundancyEnable,
  redundancyDisable,
  redundancyStage,
  redundancySet,
} from "./commands/redundancy.js";

// Known command paths and their token depths.
// Dispatch matches on the first N tokens; everything after is positional.
const COMMANDS: Record<string, number> = {
  "game search": 2,
  "game add": 2,
  "game list": 2,
  "game rate": 2,
  "game remove": 2,
  "game refresh-all-bgg": 2,
  "game set-status": 2,
  "axis list": 2,
  "axis create": 2,
  "axis update": 2,
  "axis delete": 2,
  "score list": 2,
  "score get": 2,
  "tournament start": 2,
  "tournament next": 2,
  "tournament pick": 2,
  "tournament stop": 2,
  "tournament stats": 2,
  "profile narrate": 2,
  "predict bgg": 2,
  "predict readiness": 2,
  "niche ignored": 2,
  "niche ignore": 2,
  "niche unignore": 2,
  "redundancy settings": 2,
  "redundancy enable": 2,
  "redundancy disable": 2,
  "redundancy stage": 2,
  "redundancy set": 2,
  "wishlist list": 2,
  "wishlist add": 2,
  "wishlist remove": 2,
  "wishlist clear": 2,
  "wishlist refresh": 2,
  "import bgg-collection": 2,
  "config get": 2,
  "config set": 2,
  predict: 1,
  profile: 1,
  start: 1,
  stop: 1,
  help: 1,
};

interface ParsedArgs {
  commandPath: string;
  positional: string[];
  json: boolean;
  bggId?: number;
  name?: string;
  weight?: number;
  description?: string;
  axisFlags: string[];
  filterFlags: string[];
  shape?: string;
  ideal?: number;
  tolerance?: string;
  lean?: string;
  vetoBelow?: number;
  vetoAbove?: number;
  noVeto?: boolean;
  includePredicted?: boolean;
  showNiches?: boolean;
  showRedundancy?: boolean;
  ownership?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const raw = argv.slice(2); // skip bun and script path

  // Separate flags from non-flag tokens
  const tokens: string[] = [];
  const axisFlags: string[] = [];
  const filterFlags: string[] = [];
  let json = false;
  let bggId: number | undefined;
  let name: string | undefined;
  let weight: number | undefined;
  let description: string | undefined;
  let shape: string | undefined;
  let ideal: number | undefined;
  let tolerance: string | undefined;
  let lean: string | undefined;
  let vetoBelow: number | undefined;
  let vetoAbove: number | undefined;
  let noVeto = false;
  let includePredicted = false;
  let showNiches = false;
  let showRedundancy = false;
  let ownership: string | undefined;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];

    if (arg === "--json") {
      json = true;
    } else if (arg === "--bgg-id") {
      bggId = Number(raw[++i]);
    } else if (arg === "--name") {
      name = raw[++i];
    } else if (arg === "--weight") {
      weight = Number(raw[++i]);
    } else if (arg === "--description") {
      description = raw[++i];
    } else if (arg === "--shape") {
      shape = raw[++i];
    } else if (arg === "--ideal") {
      ideal = Number(raw[++i]);
    } else if (arg === "--tolerance") {
      tolerance = raw[++i];
    } else if (arg === "--lean") {
      lean = raw[++i];
    } else if (arg === "--veto-below") {
      vetoBelow = Number(raw[++i]);
    } else if (arg === "--veto-above") {
      vetoAbove = Number(raw[++i]);
    } else if (arg === "--no-veto") {
      noVeto = true;
    } else if (arg === "--include-predicted") {
      includePredicted = true;
    } else if (arg === "--show-niches") {
      showNiches = true;
    } else if (arg === "--show-redundancy") {
      showRedundancy = true;
    } else if (arg === "--ownership") {
      ownership = raw[++i];
    } else if (arg === "--axis") {
      axisFlags.push(raw[++i]);
      axisFlags.push(raw[++i]);
    } else if (arg === "--filter") {
      if (i + 1 >= raw.length) {
        throw new Error("--filter requires a value (e.g. --filter name:wingspan)");
      }
      filterFlags.push(raw[++i]);
    } else {
      tokens.push(arg);
    }
  }

  // Match tokens against known command paths, longest first
  let commandPath = "";
  let positional: string[] = tokens;

  // Try 2-token match first, then 1-token
  if (tokens.length >= 2) {
    const twoToken = `${tokens[0]} ${tokens[1]}`;
    if (COMMANDS[twoToken] !== undefined) {
      commandPath = twoToken;
      positional = tokens.slice(2);
    }
  }
  if (!commandPath && tokens.length >= 1) {
    const oneToken = tokens[0];
    if (COMMANDS[oneToken] !== undefined) {
      commandPath = oneToken;
      positional = tokens.slice(1);
    }
  }

  return {
    commandPath,
    positional,
    json,
    bggId,
    name,
    weight,
    description,
    axisFlags,
    filterFlags,
    shape,
    ideal,
    tolerance,
    lean,
    vetoBelow,
    vetoAbove,
    noVeto: noVeto || undefined,
    includePredicted: includePredicted || undefined,
    showNiches: showNiches || undefined,
    showRedundancy: showRedundancy || undefined,
    ownership,
  };
}

// Commands that don't need the daemon
const LOCAL_COMMANDS = new Set(["start"]);

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const client = createDaemonClient();

  // Check if this command needs the daemon
  const needsDaemon = !LOCAL_COMMANDS.has(parsed.commandPath);

  if (needsDaemon && parsed.commandPath !== "stop" && parsed.commandPath !== "") {
    const reachable = await client.isReachable();
    if (!reachable) {
      console.error("Daemon is not running. Start it with: shelf-judge start");
      process.exit(1);
    }
  }

  const opts = { json: parsed.json };
  const args = parsed.positional;

  let output: string;

  switch (parsed.commandPath) {
    case "game search":
      output = await gameSearch(client, args, opts);
      break;
    case "game add":
      output = await gameAdd(client, args, { ...opts, bggId: parsed.bggId, name: parsed.name });
      break;
    case "game list":
      output = await gameList(client, args, { ...opts, ownership: parsed.ownership });
      break;
    case "game rate":
      output = await gameRate(client, args, { ...opts, axisFlags: parsed.axisFlags });
      break;
    case "game remove":
      output = await gameRemove(client, args, opts);
      break;
    case "game set-status":
      output = await gameSetStatus(client, args, opts);
      break;
    case "game refresh-all-bgg":
      output = await gameRefreshAllBgg(client, args, opts);
      break;
    case "axis list":
      output = await axisList(client, args, opts);
      break;
    case "axis create":
      output = await axisCreate(client, args, {
        ...opts,
        weight: parsed.weight,
        description: parsed.description,
        shape: parsed.shape,
        ideal: parsed.ideal,
        tolerance: parsed.tolerance,
        lean: parsed.lean,
        vetoBelow: parsed.vetoBelow,
        vetoAbove: parsed.vetoAbove,
        noVeto: parsed.noVeto,
      });
      break;
    case "axis update":
      output = await axisUpdate(client, args, {
        ...opts,
        weight: parsed.weight,
        name: parsed.name,
        description: parsed.description,
        shape: parsed.shape,
        ideal: parsed.ideal,
        tolerance: parsed.tolerance,
        lean: parsed.lean,
        vetoBelow: parsed.vetoBelow,
        vetoAbove: parsed.vetoAbove,
        noVeto: parsed.noVeto,
      });
      break;
    case "axis delete":
      output = await axisDelete(client, args, opts);
      break;
    case "score list":
      output = await scoreList(client, args, {
        ...opts,
        includePredicted: parsed.includePredicted,
        showNiches: parsed.showNiches,
        showRedundancy: parsed.showRedundancy,
      });
      break;
    case "score get":
      output = await scoreGet(client, args, opts);
      break;
    case "tournament start":
      output = await tournamentStart(client, args, {
        ...opts,
        filterFlags: parsed.filterFlags,
      });
      break;
    case "tournament next":
      output = await tournamentNext(client, args, opts);
      break;
    case "tournament pick":
      output = await tournamentPick(client, args, opts);
      break;
    case "tournament stop":
      output = await tournamentStop(client, args, opts);
      break;
    case "tournament stats":
      output = await tournamentStats(client, args, opts);
      break;
    case "predict bgg":
      output = await predictBggGame(client, args, opts);
      break;
    case "predict readiness":
      output = await predictReadiness(client, args, opts);
      break;
    case "predict":
      output = await predictGame(client, args, opts);
      break;
    case "niche ignored":
      output = await nicheIgnored(client, args, opts);
      break;
    case "niche ignore":
      output = await nicheIgnore(client, args, opts);
      break;
    case "niche unignore":
      output = await nicheUnignore(client, args, opts);
      break;
    case "redundancy settings":
      output = await redundancySettings(client, args, opts);
      break;
    case "redundancy enable":
      output = await redundancyEnable(client, args, opts);
      break;
    case "redundancy disable":
      output = await redundancyDisable(client, args, opts);
      break;
    case "redundancy stage":
      output = await redundancyStage(client, args, opts);
      break;
    case "redundancy set":
      output = await redundancySet(client, args, opts);
      break;
    case "wishlist list":
      output = await wishlistList(client, args, opts);
      break;
    case "wishlist add":
      output = await wishlistAdd(client, args, opts);
      break;
    case "wishlist remove":
      output = await wishlistRemove(client, args, opts);
      break;
    case "wishlist clear":
      output = await wishlistClear(client, args, opts);
      break;
    case "wishlist refresh":
      output = await wishlistRefresh(client, args, opts);
      break;
    case "import bgg-collection":
      output = await importBggCollection(client, args, opts);
      break;
    case "config get":
      output = await configGet(client, args, opts);
      break;
    case "config set":
      output = await configSet(client, args, opts);
      break;
    case "profile narrate":
      output = await profileNarrateCommand(client, args, opts);
      break;
    case "profile":
      output = await profileCommand(client, args, opts);
      break;
    case "start":
      output = await daemonStart(client, args, opts);
      break;
    case "stop":
      output = await daemonStop(client, args, opts);
      break;
    case "help":
      output = await helpCommand(client, args, opts);
      break;
    default:
      console.error("Usage: shelf-judge <command> [options]");
      console.error("Run `shelf-judge help` for available commands.");
      process.exit(1);
  }

  console.log(output);
}

main().catch((err) => {
  console.error(toErrorMessage(err));
  process.exit(1);
});
