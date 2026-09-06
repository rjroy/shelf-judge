# Reflection evaluation validation report

Corpus version: `2026-09-06.2`

This repository contains 60 concrete synthetic pre-generation fixtures, 20 for
each serialized Reflection question. Each fixture records question policy,
note and deterministic evidence, fixed scope, expected outcome, required and
prohibited claims, counterexample handling, adversarial input, and a distinct
rationale. Every shared-contract abstention reason, including
`conflicting-evidence`, has a concrete abstention fixture for each question.
The shared grounded-analysis adversarial harness consumes a concrete Reflection
fixture while testing payload isolation, hostile-note handling,
capability rejection, malformed submissions, citation faults, and cancellation.

The evaluator requires paired generated and baseline outputs for both reviewers,
locked scores before label reveal, provider/reviewer identity, two distinct
reviewers, and a distinct third reviewer with explicit adjudicated outcome and
scores when a trigger applies. Release gates use adjudicated scores where present,
answerable-only denominators, 90/80 grounding-scope-citation thresholds, and
70/60 strict usefulness-over-baseline thresholds. Any critical failure fails
release immediately.

## Release status: pending, fail closed

No credentialed provider output, randomized blinded review, independent fixture
authorship attestation, or human adjudication is checked into this repository.
The evaluator therefore reports a failed pending release rather than treating
fixtures or deterministic tests as semantic evaluation evidence. A release
operator must version the real provider/model identity, paired outputs, two
independent reviews with rationales and locked labels, and required third-review
adjudications. Until then, the 90/80 grounding, scope, and citation gates and
the 70/60 usefulness gates cannot pass.
