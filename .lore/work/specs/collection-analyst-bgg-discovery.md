---
title: Collection Analyst BGG discovery and preview
date: 2026-09-25
status: approved
tags: [collection, analyst, bgg, discovery, prediction]
modules: [shared, daemon, web, cli]
related:
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/research/bgg-facet-discovery-for-analyst.md
  - .lore/reference/architecture-pattern.md
  - .lore/reference/designs/mvp-bgg-integration.md
  - .lore/reference/specs/fitness/prediction-engine.md
req-prefix: ANALYSTBGG
---

# Collection Analyst BGG Discovery and Preview

## Goal and status

Give the Collection Analyst a few bounded, read-only ways to explore BGG games and estimate how one might fit the owner's collection. The owner asks a question in ordinary language; the analyst decides which available tools, if any, help answer it. This is an **approved work spec**, not established reference or shipped behavior. Once implemented, it creates an Analyst-only exception to the original chat spec's ban on BGG lookup. The existing `/search` page and BGG-ID prediction endpoint do not themselves authorize model access. Existing Analyst rules on grounding, uncertainty, privacy, cancellation, ephemerality, and no collection mutation continue to apply.

## Representative questions

- “Could Brass: Birmingham fit my collection?” The analyst may search the name, inspect the relevant game's BGG facts and predicted fitness, and cite what it actually found. If several games match, it identifies the ambiguity instead of confidently answering about the wrong one. The owner can open the interactive preview to inspect the estimate.
- “Can you find deck-building games that came out this year that I might like?” There is **no year or mechanic search tool**. The analyst may inspect the bounded Hot Items list, look up candidate games' published years and mechanics, and use predictions where useful. It can say “Among the hot games I checked...” with citations and uncertainty, but cannot claim to have found all games published that year, that a BGG community ranking measures this owner's taste, or that the owner should buy one. If the bounded sample does not support an answer, it says so.
- “Which game is BGG ID 174430?” A valid owner-supplied ID can be looked up directly. If BGG, the prediction service, or the model is unavailable, the analyst distinguishes the failure from “no game,” “no matches,” and “predicted score of zero.”

## Capability model

The daemon always offers the Analyst model these feature-specific tools on every chat turn, alongside its existing authorized collection-evidence and structured-answer tools. The model may use them in any order, use only some, or use none. **These are capabilities, not a prescribed search → filter → owner selection → preview sequence.** Every invocation has strict inputs, bounded outputs, a finite per-turn request budget, cancellation, and server-selected evidence/citation identities. Exact numerical bounds and operation schemas belong to design.

There is no per-turn intent classifier or owner-selection gate controlling whether the tools are exposed. The analyst decides whether BGG evidence would help answer the owner's question, including collection-only or mixed questions, and must be candid when it is irrelevant or insufficient. Availability does not relax the tool-specific input bounds: name-search text still comes from an owner-provided title or confirmed refinement, and ID lookups still use returned or owner-supplied IDs. Prompt injection in retrieved content cannot broaden any tool's inputs or privileges.

| Tool | Model-visible request | Authorized result |
| --- | --- | --- |
| Name search | A bounded board-game title query (`/xmlapi2/search`: `query`, `type=boardgame`, optional `exact`). Query text must come from an owner-provided title or an owner-confirmed refinement, never from private collection evidence or model-generated prose. | Bounded candidates: BGG ID, primary title, optional year; search observation, count, truncation, and time. This is name matching, not general semantic, year, or mechanic search. |
| Hot Items review | A fixed `/xmlapi2/hot?type=boardgame` request; no model-supplied query, category, year, mechanic, or URL. | A bounded, time-stamped sample of BGG IDs and available identity fields with count and truncation. “Hot” means an activity-oriented sample, not every eligible game or a personal recommendation. |
| Game facts | One or a bounded batch of validated board-game IDs returned by either discovery tool or explicitly supplied by the owner. Uses `/xmlapi2/thing` through the daemon BGG client. | Verified BGG identity, primary name, published year and mechanic identities/names when available, plus source time/warnings. A missing field stays missing; no title-derived mechanic or year. This is a fact lookup, not a facet-search endpoint. |
| Fitness preview | One validated board-game ID returned by discovery/facts or explicitly supplied by the owner. Uses the existing non-persisted BGG prediction path. | A strict projection of the current estimate, per-axis breakdown/source, readiness/unavailable state, confidence, and bounded reference-game identities. If already in the collection, return current collection status and score/prediction rather than a fictitious new-game estimate. |

The model can invoke the preview tool without a separate owner click; preview is a read-only computation, not an add/save action. An owner-facing interactive preview can show more detail and navigation, but does not gate the model's ability to inspect a bounded estimate. The model cannot invent BGG IDs, bulk scan an ID range, invoke an undocumented advanced-search API, browse BGG pages, follow arbitrary URLs, access credentials, or perform collection operations. Invalid, absent, non-boardgame, mismatched, or duplicate-collection IDs are handled explicitly. Name-only similarity does not prove a collection match. An owner may choose or correct a candidate in chat when identity is uncertain; the model must not silently resolve ambiguity as fact.

The answer is grounded in **what was actually inspected**, not in a required tool plan. The model may use year/mechanic facts to reason about candidates, including the owner's “this year” interpreted as the current calendar year at request time and stated when relevant. An unknown mechanic or year cannot support a positive claim about it. No tool promises to find all titles with a given mechanic/year. The analyst may point the owner to BGG's website advanced search for broader discovery, without claiming there is an equivalent documented XML API2 endpoint.

## Evidence, disclosure, and failure boundaries

Extend the versioned Analyst authorization manifest with the four **narrow result projections above**, not raw BGG XML or broad prediction responses. They are available on every Analyst turn but reach the model only when it invokes a tool. The daemon owns a turn-scoped evidence registry, observation times, and safe destinations:

- Name-search and Hot **observation citations** support result count, empty result, sample scope, truncation, and time even when no item exists. Their destination is the ephemeral discovery-results surface in the current conversation, never an invented item page or query-bearing URL.
- Candidate and game-fact citations resolve to the canonical BGG item page with a BGG source label. A claim about year or mechanics cites a Thing observation for that ID, not merely its presence in Hot or a title-search result. A claim about current Hot membership cites a fresh Hot observation and cannot silently reuse an old one.
- Fitness and collection claims cite versioned local preview calculations and current collection/profile evidence. BGG community ratings and Hot placement are not evidence that this owner likes a game. Owner notes remain owner testimony, never BGG facts. A substantive answer about an external game distinguishes BGG provenance from local prediction and collection citations.

BGG names and metadata are untrusted content, not instructions. Tool output cannot set policy, trigger another permission, choose citation IDs, or provide an arbitrary destination. On a later turn, prior BGG facts and preview prose in the transcript are not current evidence: reacquire/revalidate sources before making current claims, or explain that they are unavailable or changed. Runtime citation checks establish provenance, not semantic truth.

Before the first send, disclose that title queries or owner-supplied BGG IDs may go to BGG; Hot review sends a fixed request followed by selected IDs for Thing/preview lookups, not the owner's chat text, collection, notes, or preferences. BGG facts and relevant authorized collection evidence may go to the configured model provider, subject to its policy; BGG also has its own processing policy. Existing selective owner-note disclosure and model-provider terms still apply. No BGG query, returned/selected ID, transcript, raw BGG response, token, or provider payload enters durable chat/search history or operational logs; redacted logs may include operation type, counts, timing, and outcome. The existing application token stays in the daemon-owned BGG client. Verify current BGG API terms and authorization in design; no official rate limit or retention permission is assumed here.

Server bounds apply to query length, result/sample size, Thing batch size, preview calls per turn, timeouts, and BGG-client pacing/retries. A partial Hot or Thing lookup is reported as partial coverage, not “no matching games”; an empty inspected sample is not proof of global absence. Cancellation/disconnect aborts ongoing work where supported, leave no completed assistant answer for the cancelled turn, and cannot undo requests already transmitted. Distinguish empty name matches, no useful hot candidates, ambiguous identity, invalid ID, missing metadata, missing BGG authentication, BGG throttling/outage, prediction unavailability, and provider failure. No silent fallback, automatic charged provider retry, collection/wishlist/note/configuration mutation, chat cache, or automatic BGG call outside a model-chosen Analyst tool invocation. Reflections remain without BGG tools.

## Requirements

1. **REQ-ANALYSTBGG-1:** Every Analyst chat turn must expose bounded name search, fixed boardgame Hot review, validated-ID game facts, and read-only fitness preview to the model; the model chooses whether and in what order to call them without an owner intent gate or forced workflow, and no BGG request occurs unless the model invokes an authorized tool.
2. **REQ-ANALYSTBGG-2:** Name search must use only documented title-query inputs derived from an owner-provided title/confirmed refinement; Hot review must use only the fixed boardgame request; neither exposes general browsing, year/mechanic search, arbitrary URLs, or model-chosen BGG query text from private evidence.
3. **REQ-ANALYSTBGG-3:** Game facts must expose verified BGG identity, year, and mechanics when present for bounded validated IDs, and fitness preview must expose a bounded, non-persisted estimate or explicit unavailable state, including existing-collection identity where applicable.
4. **REQ-ANALYSTBGG-4:** Answers must distinguish limited discovery coverage, missing facts, BGG activity/ratings, local predicted fitness, and owner preferences; they must not invent complete facet coverage, certainty, a personal rating, or buy/sell intent.
5. **REQ-ANALYSTBGG-5:** Every substantive external-game or collection claim must resolve to its appropriate turn-scoped BGG observation/item fact or current local calculation/collection evidence; empty results need observation-level citations without invented item IDs, and stale evidence cannot be passed off as current.
6. **REQ-ANALYSTBGG-6:** Discovery disclosure, provider payloads, BGG requests, redacted logs, cancellation, and failures must respect the privacy and read-only boundaries above, including a finite per-turn tool budget and no model-driven durable mutation.
7. **REQ-ANALYSTBGG-7:** The daemon-owned BGG client and shared pi-agent boundary alone may expose these strict tools to Analyst chat; Reflections remain without BGG tools, and no Analyst turn makes a BGG request except through an authorized model-invoked tool.

## AI Validation

1. Give the analyst varied open-ended questions: a named external game, an ambiguous partial title, a valid owner-supplied BGG ID, “deck-building games from this year that I might like,” a collection-only question, and a mixed owned/external comparison. With deterministic model/tool fixtures, verify all four tools are exposed on every Analyst turn and none is called automatically; the model can call them in different useful sequences or use none. Do not test for one mandatory tool sequence or reject a turn solely for being collection-only. Verify the sample answer qualifies coverage and separates BGG facts from predicted personal fitness.
2. Capture BGG calls for title search, Hot, Thing, and preview. Reject model-supplied collection-derived queries, undocumented filters, arbitrary URLs, invented/invalid/non-boardgame IDs, oversized batches, and budget overruns. Ensure no owner transcript, notes, collection ratings, or provider secret crosses to BGG; verify the provider receives only manifest fields.
3. Exercise a zero-hit title search, empty Hot response, partial Hot/Thing retrieval, stale observation, unknown year/mechanic, ambiguous titles, duplicate collection IDs, prediction stage 0, and prediction outage. Verify precise limitations and server-owned citations even when no candidate exists; no global absence claim or fabricated score.
4. With a controlled collection, compare the model-visible fitness projection and interactive preview to the existing prediction service. Check actual-versus-predicted labels, source time, confidence, local reference-game provenance, collection-match state, and unchanged durable collection/wishlist/notes/settings after repeated previews.
5. Inject instructions and fake citations into BGG names and metadata; change BGG facts/Hot membership and local collection evidence between turns; cancel during each tool and during model response. Verify no permission escalation, stale-as-current citation, completed cancelled answer, automatic charged retry, or raw user text/ID/token in logs. Check web and CLI consumers of the same daemon outcomes where exposed.

## Scope and design handoff

No mechanic/year catalogue search, bulk BGG harvesting, undocumented advanced-search API, website scraping, general browsing, model-directed mutation, purchase recommendation, or new prediction math. The dependent design task (`shelf-judge-8ss.2`) sets concrete tool schemas, limits, UI presentation, and BGG-terms validation. It must preserve the model's freedom to choose among these narrow read-only tools rather than encode this document's examples as a rigid workflow.
