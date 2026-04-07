---
title: "Deferred: Prediction engine for unowned games"
date: 2026-04-06
status: open
tags: [deferred, feature, fitness, prediction]
modules: [daemon]
origin: .lore/specs/mvp.md
stub: "[STUB: prediction-engine]"
---

# Prediction engine for unowned games

MVP scores only games in the user's collection that have personal ratings. There is no way to estimate fitness for a game you haven't played or rated.

## What was deferred

A similarity engine that predicts fitness scores for unowned games based on the user's existing rating patterns. If you consistently rate thematic games highly and a new thematic game has strong BGG community data, the system would estimate a likely fitness score.

## Why it was deferred

Prediction requires enough rated data to be meaningful. With a fresh collection, any prediction would be noise. The feature only becomes useful after the user has built up a meaningful rating history across enough games and axes that statistical patterns emerge.

## Context for pickup

- Depends on having a populated collection (probably 20+ rated games minimum for useful signal).
- BGG data (mechanics, categories, weight, player counts) provides the feature vectors for similarity.
- Personal axis ratings provide the training signal.
- Exit point defined in spec: triggers when "user wants scores for unowned games."
