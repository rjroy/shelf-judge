---
title: "Open question: Axis weight UX (raw numbers vs normalized sliders)"
date: 2026-04-06
status: declined
tags: [ux, axes, web-ui]
modules: [web, daemon]
origin: .lore/specs/mvp.md
---

# Axis weight UX: raw numbers vs normalized sliders

The MVP spec flagged this as an open question to resolve through use. The implementation went with raw numbers (0-100), and the API normalizes them in the score calculation (divides by sum of weights). The question of whether the UI should present weights as percentages or relative sliders remains unresolved.

## The question

Should weight be a raw number (1-100) that the user sets independently per axis, or a relative slider where all weights auto-normalize to 100%? Raw numbers are simpler and currently implemented. Normalized sliders are more intuitive for users who think in terms of "this axis is 30% of my score."

## Current state

Raw numbers are implemented and functional. The API handles the normalization math. The web UI shows the raw weight value. No user feedback has been collected to determine whether this is confusing in practice.

## Why it matters

If users consistently misunderstand what weight values mean (thinking 50 means "50% of the score" when it doesn't unless all weights sum to 100), the UX should present normalized percentages. But if users understand that weights are relative, raw numbers are simpler and more flexible.

## Resolution path

Collect feedback from actual use. If weight confusion shows up, implement a percentage display or auto-normalization UI. The storage model (raw integers) doesn't need to change either way.
