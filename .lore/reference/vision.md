---
title: "Shelf Judge Vision"
date: 2026-04-03
status: active
tags: []
---

# Vision

Shelf-judge is a board game collection tool that helps owners understand what their shelf actually says about them, and make informed decisions about what stays, what goes, and what comes next. It combines personal, multi-axis ratings with data from Board Game Geek to produce a single fitness score for any game, owned or not. It serves the collector who wants their shelf to be intentional, not accumulated.

# Principles

## 1. Ownership is personal and specific

A game earns its place for reasons unique to the owner. The system rates along multiple user-defined axes because "good" is never one thing.

**Looks like:** A user creates a "date night playability" axis and rates games on it. That axis feeds into their fitness score alongside weight, theme, and play time.
**Doesn't look like:** A fixed set of rating categories that every user must use, where "my wife will play this" has no place to live.

## 2. One number, honestly derived

The fitness score is powerful because it's singular, but the owner can crack it open and see which axes drove it, how each was weighted, and what data came from BGG vs. their own ratings. Transparency is what makes the number trustworthy.

**Looks like:** Tapping a fitness score shows a breakdown: "date-night: 9, complexity: 4 (BGG weight: 2.1), theme-fit: 7, redundancy penalty: -2."
**Doesn't look like:** A number appears and the user has to reverse-engineer why Azul scores higher than Wingspan.

## 3. Your collection has an identity

The pattern of what you own and why you own it encodes preferences you may never have articulated. Shelf-judge makes that identity legible to the person who built it.

**Looks like:** After rating 20 games, the system can surface: "You favor low-interaction, medium-weight games with strong visual design. Party games score consistently low on your axes."
**Doesn't look like:** The system stores games as isolated records with no relationship to each other or to the owner's preference profile.

## 4. Data serves judgment, not replaces it

BGG provides context: community ratings, weight, mechanics, categories, player counts. The fitness score synthesizes this alongside personal ratings. But the owner decides. The score is a mirror, not an oracle.

**Looks like:** BGG says a game is rated 8.2 with 3.4 weight. The system incorporates that into the fitness calculation, but the user's personal axes still dominate the score.
**Doesn't look like:** BGG community rating IS the fitness score, or a game with low BGG ratings can't score high because the owner loves it for personal reasons.

## 5. The shelf has a carrying capacity

Fitness is relative, not absolute. Adding a game changes the fitness of every other game competing for that space. A fifth worker-placement game isn't as fit as the first, even if it's individually excellent.

**Looks like:** Adding a new area-control game slightly decreases the fitness of the two area-control games already on the shelf. The system surfaces this.
**Doesn't look like:** Fitness is calculated in isolation per game, blind to what else is already there.

# Anti-Goals

- **Automated purchase decisions.** Shelf-judge does not tell you what to buy. It shows you what the data looks like through the lens of your preferences. "High predicted fitness" is information, not a recommendation.
- **Social/competitive collection features.** No leaderboards, no "top collectors," no public profiles. This is a personal curation tool, not a social platform.
- **BGG replacement.** Shelf-judge is not a game database. It pulls from BGG; it doesn't compete with it. Game discovery, reviews, forums, and marketplace belong to BGG.

# Tension Resolution

| Tension                                   | Default Winner | Exception                                                                       |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| Personal axes vs BGG data accuracy        | Personal axes  | When BGG data corrects a factual error (e.g., listed player count)              |
| Fitness precision vs transparency         | Transparency   | Never. A score the user can't interrogate is worthless.                         |
| Collection-aware fitness vs simplicity    | Simplicity     | Until the user has enough rated games for redundancy detection to be meaningful |
| Prediction coverage vs prediction honesty | Honesty        | Never. "Insufficient data" is better than a confident wrong number.             |
