---
title: "ESLint disableTypeChecked for web test files"
date: 2026-04-10
status: open
tags: [debt, lint, testing, workaround]
modules: [web]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# ESLint disableTypeChecked for Web Test Files

## What Happened

`disableTypeChecked` was applied to web test files as a workaround for conflicting tsconfig settings. Web tests get no type-aware lint coverage as a result. No follow-up to fix the root cause was filed.

## Why It Matters

Type-aware ESLint rules catch a meaningful class of bugs (incorrect awaits, unsafe type assertions, unhandled promise rejections). Disabling them for test files means the test suite, where incorrect types are most likely to produce false confidence, gets the least lint scrutiny.

## Fix Direction

Resolve the tsconfig conflict that prompted the workaround. This likely involves either a separate `tsconfig.test.json` that ESLint can reference, or adjusting the existing tsconfig to include test paths properly.
