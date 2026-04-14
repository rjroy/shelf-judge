---
title: "One Pass Bracket Mode"
date: 2026-04-14
status: open
---

Adding a mode of the tournament which reduces the checks by enforcing expected match results to prevent the pairing.

Ex: Giving games a, b, c, d
test: a > b
test: b > c
skip: a to c because guess a > c
test: b > d
still need to test c and d because even though they have already been tested there's not enough info to test. 
test: c > d