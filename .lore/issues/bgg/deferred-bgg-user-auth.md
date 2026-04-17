---
title: "Deferred: BGG user authentication"
date: 2026-04-06
status: parked
tags: [deferred, feature, bgg, auth]
modules: [daemon]
origin: .lore/specs/mvp.md
---

# BGG user authentication

MVP uses only public BGG data via an application token. There is no BGG user login.

## What was deferred

BGG user authentication, which would unlock access to private collection data: acquisition price, private notes, wishlist status, and other fields BGG marks as user-only. The current application token approach only accesses publicly visible data.

## Why it was deferred

BGG user auth adds OAuth-like complexity (BGG's auth flow, token management, session handling) for marginal MVP value. The public data (ratings, weight, mechanics, categories, player counts) covers everything the fitness model needs. Private data like acquisition price could feed future features (cost-per-play analysis) but isn't part of the current scoring model.

## Context for pickup

- BGG API research (`.lore/research/bgg-api.md`) documents the auth requirements.
- The daemon already handles application tokens via config. User auth would add a second credential type.
- Private data of interest: acquisition price (cost-per-play), private notes, wishlist items, trade list.
- No exit point stub defined in spec (this was listed as a deferred item but not given a stub).
