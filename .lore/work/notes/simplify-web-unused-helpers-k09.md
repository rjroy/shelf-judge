---
title: "Simplify unused web score and API helpers"
date: 2026-09-23
status: complete
tags: [cleanup, web, dead-code]
source: shelf-judge-k09
modules: [web]
---

# Simplify unused web score and API helpers

Removed the unreferenced `ScoreBadge` component and its two exclusive CSS rules. Removed uncalled shelf mutation, shelf assignment, and wishlist API wrappers from `packages/web/lib/api.ts`, leaving used helpers and shared score styles intact.

Fresh reference searches found no callers. Web typecheck, focused web tests (94), and targeted formatting passed during cleanup. Full typecheck, lint, tests, build, browser typecheck, and formatting passed afterward. Independent review found no material regression. Concurrent CLI, other lore, and Beads changes were left untouched.
