#!/usr/bin/env bun
// shelf-judge CLI entry point.
// Parses arguments, checks daemon reachability, dispatches to command handlers.

import { createDaemonClient } from "./client.js";
import { gameSearch, gameAdd, gameList, gameRate, gameRemove, gameRefreshAllBgg } from "./commands/game.js";
import { axisList, axisCreate, axisUpdate, axisDelete } from "./commands/axis.js";
import { scoreList, scoreGet } from "./commands/score.js";
import { importBggCollection } from "./commands/import.js";
import { configGet, configSet } from "./commands/config.js";
import { daemonStart, daemonStop } from "./commands/daemon.js";
import { helpCommand } from "./commands/help.js";

// Known command paths and their token depths.
// Dispatch matches on the first N tokens; everything after is positional.
const COMMANDS: Record<string, number> = {
  "game search": 2,
  "game add": 2,
  "game list": 2,
  "game rate": 2,
  "game remove": 2,
  "game refresh-all-bgg": 2,
  "axis list": 2,
  "axis create": 2,
  "axis update": 2,
  "axis delete": 2,
  "score list": 2,
  "score get": 2,
  "import bgg-collection": 2,
  "config get": 2,
  "config set": 2,
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
}

function parseArgs(argv: string[]): ParsedArgs {
  const raw = argv.slice(2); // skip bun and script path

  // Separate flags from non-flag tokens
  const tokens: string[] = [];
  const axisFlags: string[] = [];
  let json = false;
  let bggId: number | undefined;
  let name: string | undefined;
  let weight: number | undefined;
  let description: string | undefined;

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
    } else if (arg === "--axis") {
      axisFlags.push(raw[++i]);
      axisFlags.push(raw[++i]);
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

  return { commandPath, positional, json, bggId, name, weight, description, axisFlags };
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
      output = await gameList(client, args, opts);
      break;
    case "game rate":
      output = await gameRate(client, args, { ...opts, axisFlags: parsed.axisFlags });
      break;
    case "game remove":
      output = await gameRemove(client, args, opts);
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
      });
      break;
    case "axis update":
      output = await axisUpdate(client, args, {
        ...opts,
        weight: parsed.weight,
        name: parsed.name,
        description: parsed.description,
      });
      break;
    case "axis delete":
      output = await axisDelete(client, args, opts);
      break;
    case "score list":
      output = await scoreList(client, args, opts);
      break;
    case "score get":
      output = await scoreGet(client, args, opts);
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
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
