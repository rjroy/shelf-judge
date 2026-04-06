---
title: "MVP CLI Surface"
date: 2026-04-04
status: implemented
tags: [design, cli, commands, mvp]
modules: [cli]
related:
  - .lore/specs/mvp.md
  - .lore/designs/mvp-api-surface.md
  - .lore/reference/architecture-pattern.md
---

# Design: MVP CLI Surface

Satisfies: REQ-MVP-6, REQ-MVP-1, REQ-MVP-2, REQ-MVP-3, REQ-MVP-4, REQ-MVP-11

The CLI discovers operations from the daemon at runtime. No hardcoded command catalog.

## Binary

`shelf-judge` (or `sj` alias). Connects to the daemon's Unix socket.

## Core Commands

```
shelf-judge help                        # Full operation tree
shelf-judge game search "wingspan"      # Search BGG
shelf-judge game add --bgg-id 266192    # Add by BGG ID
shelf-judge game add --name "Custom"    # Add manually
shelf-judge game list                   # All games with fitness scores
shelf-judge game rate <id> --axis "Wife will play it" 8 --axis "Visual design" 9
shelf-judge axis list                   # All axes
shelf-judge axis create "Wife will play it" --weight 40
shelf-judge axis update <id> --weight 50
shelf-judge import bgg-collection <username>
shelf-judge score list                  # Games ranked by fitness
shelf-judge score get <id>             # Full breakdown for one game
shelf-judge config set bgg-token <token>
```

## Output

Default output is human-readable tables. The `--json` flag on any command returns raw JSON for scripting and agent consumption.

## Daemon Management

The CLI checks whether the daemon is running on the expected socket. If not:

- `shelf-judge start` starts the daemon in the background
- `shelf-judge stop` stops it
- Commands that need the daemon prompt the user to start it if it's not running
