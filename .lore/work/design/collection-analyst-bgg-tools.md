---
title: Bounded BGG discovery and fitness preview in Collection Analyst
date: 2026-09-25
status: approved
tags: [collection, analyst, bgg, discovery, prediction, provenance]
modules: [shared, daemon, web, cli]
related:
  - .lore/work/specs/collection-analyst-bgg-discovery.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/reference/architecture-pattern.md
---

# Bounded BGG discovery and fitness preview in Collection Analyst

## Decision

Add four optional, Analyst-only, model-invoked tools at the daemon's existing pi-agent boundary: owner-title search, fixed boardgame Hot observation, verified Thing facts, and local fitness preview. Reuse the existing BGG client's authentication, serialized queue, pacing, retry, XML parsing, and the existing prediction engine, but add narrow privacy-safe/cancellable client methods and extract preview orchestration below the HTTP route. Expose only allowlisted, turn-local evidence. Do **not** add browsing, facet search, a mandatory tool sequence, a collection mutation, or BGG tools to Reflections. This is a design for the approved spec, not an assertion that the current code already supports it.

The existing Analyst calls `analyzeFreeform` and creates answered blocks with empty citations (`packages/daemon/src/services/analyst-turn-service.ts`); its manifest lists four collection tools only (`grounded-analysis/structured-submission.ts`). Therefore the new provenance requirement requires an explicit structured conversational submission and runtime resolution of citation IDs, not just prompt wording. The existing prediction route composes niche/redundancy calculations separately from `predictBggGame`, and `getGame` fetches the configured BGG user's collection as well as Thing. Neither the route nor that method is a safe direct Analyst adapter.

## Authority and data flow

`packages/shared/src/collection-analyst.ts` owns strict, versioned public request/result, discovery receipt, evidence, disclosure, and stream schemas. `packages/daemon/src/services/analyst-turn-service.ts` owns validated owner-message spans, the authorized-ID set, turn budget, turn evidence registry, and final-answer validation. New Analyst-specific tool definitions live next to `grounded-analysis/collection-tools.ts` but are registered only in the Analyst manifest/provider allowlist; the Reflection manifest remains unchanged. The BGG client owns all outbound BGG HTTP/XML and token access. The prediction service owns calculation; a reusable preview service owns shared route/Analyst orchestration, while each consumer applies its own projection. Web/CLI consume daemon-generated view data, never call BGG on the model's behalf.

Flow: validated transcript and disclosure → model chooses a tool → daemon validates authorized inputs and reserves budget → existing BGG transport/new narrow method or local calculation → strict projection plus server-created evidence record → model submits conversational answer with registry citation IDs → daemon resolves, validates, and emits blocks/citations/optional view data. A collection-only turn need not send any BGG request. A client opening an already returned card/citation does not refetch BGG. The pre-existing owner-initiated prediction HTTP route is a separate operation; it does not count as an automatic Analyst request.

## Enforceable inputs and limits

All numbers below are **application limits**, not BGG-published quotas. Fail closed on overflow; never silently truncate a tool input. Count even rejected tool invocations toward a 24-invocation turn limit, with atomic reservation before asynchronous work. Allow at most two title searches, one Hot observation, two facts calls, three previews, 20 distinct Thing IDs and 12 BGG HTTP attempts inclusive of retries/enrichment (enrichment is disabled for these tools). Search emits at most 10 candidates per call; Hot emits at most 20; facts accepts 1–10 unique IDs; preview accepts one. Cap every projected tool response at 32 KiB and all projected tool responses at 128 KiB per turn; bound names and strings separately. Apply a 120-second Analyst turn deadline and the existing BGG transport timeout/pacing/retry policy, with the HTTP-attempt counter enforced inside the transport before a request or retry. Exhaustion is a typed limitation, never an extra network call or automatic paid provider retry. These numbers may be tightened after measured integration tests; do not claim a verified BGG rate limit.

| Tool | Model arguments, strictly parsed | Server result and evidence |
| --- | --- | --- |
| `searchBggTitles` | `{ownerMessageIndex, start, end, exact?: boolean}`; half-open Unicode code-point offsets into one owner message; resulting substring 2–120 code points, trimmed at boundaries, no controls/URLs | `{status, observedAt, returnedCount, emittedCount, truncated, candidates:[{bggId, primaryName, yearPublished?}], observationCitationId}` and candidate citation IDs. `returnedCount` is API rows, **not** catalogue total. No thumbnails, descriptions, aliases, raw XML or model-supplied query echo. |
| `reviewBggHot` | `{}` only | Fixed `/xmlapi2/hot?type=boardgame`; `{status, observedAt, returnedCount, emittedCount, truncated, candidates, observationCitationId}`. Rank/Hot membership only from this observation; activity sample is not owner fitness. |
| `readBggFacts` | `{bggIds:number[]}` | Per-ID verified boardgame identity, primary name, optional year and bounded mechanic `{id,name}` list with field-availability/warnings, observed time and Thing citation. Per-ID failures/partial coverage remain distinct; no invented `Unknown` identity. |
| `previewBggFitness` | `{bggId:number}` | `{state: predicted | existing | existing-local-unverified | unavailable | ambiguous, bggLookup: {status: verified | failed, errorCode?: safe code}, ...}` with actual-vs-predicted label, readiness, confidence if available, bounded per-axis score/source, local version/calculation time, BGG observation time **only when verified**, and bounded reference-game IDs/names. `existing-local-unverified` carries current ownership/local score but no fresh BGG fields or Thing citation; `unavailable` carries no new-game score. Stage 0 remains an unavailable **personal prediction**, not necessarily a numeric zero or absence of derived-axis scoring. |

### Closed model-visible result shapes

These are the normative strict result envelopes (no additional keys); implement in shared Zod schemas and derive both provider-tool serialization and view-model types from them. `Id` is a positive safe integer; `Time` is an offset-aware ISO timestamp; `CitationId` is a bounded server-issued opaque string; `Text` is a bounded plain-text string (name ≤160 Unicode code points, mechanic name ≤80). All arrays have explicit caps above. A `Failure` is `{status:"error", code: InvalidInput | UnauthorizedId | NotConfigured | BggUnauthorized | BggThrottled | BggQueuedTimeout | BggOutage | BggParse | MissingGame | NonBoardgame | MismatchedId | BudgetExhausted | ToolTimeout | PredictionUnavailable, retryable:boolean}`; it contains neither a citation nor a fabricated observation. Validation errors consume a tool invocation but never cause BGG traffic. The provider receives safe codes only; the web/CLI map them to explanatory copy.

```ts
type Candidate = {
  bggId: Id; primaryName: Text; yearPublished: number | null;
  identityCitationId: CitationId;
};
type DiscoveryResult =
  | { status: "ok"; source: "title" | "hot"; observedAt: Time;
      returnedCount: number; emittedCount: number; truncated: boolean;
      observationCitationId: CitationId; candidates: Candidate[] }
  | Failure;
// Both tools share this result, but source is fixed per tool. A zero-hit success has
// candidates:[], counts:0, and an observationCitationId. No query text is returned.
// emittedCount === candidates.length <= 10 for title, <= 20 for Hot;
// returnedCount >= emittedCount, truncated === (returnedCount > emittedCount).

type ThingFact = { bggId: Id; primaryName: Text; yearPublished: number | null;
  mechanics: { id: Id; name: Text }[]; mechanicsComplete: boolean;
  missingFields: ("year" | "mechanics")[]; warnings: ("partial-links")[];
  observedAt: Time; factCitationId: CitationId }; // <= 20 mechanic entries
type FactFailure = { bggId: Id; code: "MissingGame" | "NonBoardgame" |
  "MismatchedId" | "BggUnauthorized" | "BggThrottled" |
  "BggQueuedTimeout" | "BggOutage" | "BggParse"; retryable: boolean };
type FactsResult =
  | { status: "ok" | "partial"; requestedCount: number;
      facts: ThingFact[]; failures: FactFailure[]; coverage: "complete" | "partial" }
  | Failure;
// ok iff failures is empty and all requested IDs appear exactly once in facts;
// partial iff at least one per-ID failure; facts + failures partition requested IDs.
// A whole-request transport failure is Failure. No fact citation on a failed ID.

type PreviewAxis = { axisId: string; axisName: Text; value: number | null;
  source: "actual" | "predicted" | "derived" | "missing";
  confidence: "actual" | "strong" | "moderate" | "weak" | "insufficient" | null };
type PreviewScore = { value: number; label: "actual" | "predicted";
  readinessStage: 0 | 1 | 2 | 3;
  confidence: "actual" | "strong" | "moderate" | "weak" | "insufficient" | null;
  predictionUnavailable: null | { reason: "stage-0"; ratedGameCount: number;
    gamesNeeded: number }; axes: PreviewAxis[]; // <= 20, deterministic order
  referenceGames: { gameId: string; gameName: Text }[] }; // <= 5
type PreviewCommon = { bggId: Id;
  bggLookup: { status: "verified"; observedAt: Time; factCitationId: CitationId }
    | { status: "failed"; code: FactFailure["code"] | "NotConfigured"; retryable: boolean };
  calculatedAt: Time; sourceVersion: string; calculationCitationId: CitationId };
type PreviewResult =
  | ({ status: "ok"; state: "predicted"; primaryName: Text;
       bggLookup: Extract<PreviewCommon["bggLookup"], {status:"verified"}>;
       score: PreviewScore } & Omit<PreviewCommon, "bggLookup">)
  | ({ status: "ok"; state: "existing"; primaryName: Text;
       bggLookup: Extract<PreviewCommon["bggLookup"], {status:"verified"}>;
       collectionGameId: string; ownership: "owned" | "previously-owned" | "other";
       collectionCitationId: CitationId; score: PreviewScore } & Omit<PreviewCommon, "bggLookup">)
  | ({ status: "partial"; state: "existing-local-unverified";
       bggLookup: Extract<PreviewCommon["bggLookup"], {status:"failed"}>;
       collectionGameId: string; collectionName: Text;
       ownership: "owned" | "previously-owned" | "other";
       collectionCitationId: CitationId; score: PreviewScore } & Omit<PreviewCommon, "bggLookup">)
  | { status: "unavailable"; state: "unavailable"; bggId: Id;
      code: Failure["code"]; retryable: boolean;
      predictionUnavailable: null | { reason: "stage-0";
        ratedGameCount: number; gamesNeeded: number } } // no score/citation
  | { status: "partial"; state: "ambiguous"; bggId: Id;
      collectionGameIds: string[]; code: "AmbiguousCollectionMatch" } // <= 10; no score
  | Failure;
```

`PreviewScore.value` is the existing service's displayed `FitnessResult.score`, not a newly normalized rating; its label derives from actual/predicted source, never BGG community ratings. If Stage 0 has no displayable score, use the `unavailable` preview variant with `PredictionUnavailable` rather than manufacture a numeric zero; a genuine available derived-axis score can carry `predictionUnavailable: stage-0`. Axis `value:null` is explicitly missing, not zero. For existing local-only results, `collectionName` is labelled local and no BGG name/fact citation is present. `sourceVersion` binds the local collection/profile/scoring algorithm and permitted Thing input version; an inspector resolves the opaque calculation citation to its stored-in-turn provenance. `FactsResult` with no successes and per-ID failures is still `partial` so the caller can explain each inspected failure; no result claims overall absence.

Search title extraction is from the **validated owner transcript**, never model-submitted free text or collection evidence. A confirmed refinement must be restated by the owner as a title; a bare “yes” cannot authorize assistant text. A span proves owner origin but cannot mathematically prove that natural-language words are a *title*. Keep the model's instruction to select only owner-provided titles; refuse obvious non-title/URL/control spans, and state this semantic limitation rather than claiming a classifier can enforce it. If product requires hard semantic enforcement, add explicit owner-designated title spans in a later contract rather than a hidden intent gate.

Admit IDs to a turn-local permission registry only from an explicit owner `BGG ID 174430`/canonical BGG item URL, validated emitted search/Hot IDs, or authenticated prior-turn discovery receipts. Do not treat arbitrary owner numbers, model prose, collection BGG IDs, un-emitted candidates, or unrequested Thing response rows as authorization. Parsing requires positive safe integer, uniqueness, and exact requested/returned ID match. A permitted ID is **lookup authorization**, not verified boardgame identity. Thing must validate the returned item type and primary name and distinguish absent/non-boardgame/mismatched/unknown fields. Facts and preview both require permitted IDs, but the model may invoke either first for an explicit owner ID. No name-only match to an owned game.

## BGG integration and cancellation

`GameService.searchGames(query, signal?)` is the existing search seam, but its current `BggClient.searchGames()` enriches thumbnails with hidden Thing requests and returns an unbounded array. Add a narrow `searchBoardgameTitles` path sharing the same transport/parser but **without enrichment**, and return an observation envelope even for zero hits. `reviewBoardgameHot` is a fixed-request client method. `getBoardgameFacts(ids, signal)` is Thing-only, not existing `getGame()`/`getGames()` as-is: they can fetch configured-user collection data and lack a signal. Reuse internal Thing parsing, auth, request serialization, 202 handling, 429/5xx backoff, and abortable queue/delay/fetch/body behavior, while preserving missing/invalid field distinctions. Do not create another HTTP/XML stack. Ensure `type=boardgame` request filters do not replace **response** type validation.

Thread one abort signal through the tool dispatch, queued requests, transport delays and retries, Thing response, calculation, and final submission checkpoints. Check before starting each operation, not only in a promise race. On stop/disconnect, prevent a completed answer from being published; already transmitted BGG requests cannot be recalled. No automatic retry of the model request. Errors are typed at the boundary: invalid input/unauthorized ID, no title matches, empty Hot sample, ambiguous identity, missing item/non-boardgame/mismatched item, missing field/partial batch, BGG not configured/401, 429, queued-timeout/outage/parse error, budget/deadline, prediction unavailable, provider failure, and cancelled. Empty success gets an observation citation; transport failure never masquerades as zero hits. Do not pass raw upstream bodies/messages to the model or owner.

## Preview reuse and collection identity

Extract the existing route's prediction/niche/redundancy orchestration into a reusable preview service consumed by `GET /predictions/bgg/:bggId` and the Analyst tool. Preserve existing prediction math and the route's full owner-facing projection. The Analyst tool receives a separate strict projection, not `projectPredictedGameResponse` wholesale. Accept verified Thing data already acquired this turn, a coherent local prediction snapshot, an abort signal and explicit source versions; avoid a duplicate Thing fetch within the turn. Do not hold a collection lock over network waiting; revalidate local dependencies before publishing. The route remains an HTTP adapter, not an internal tool endpoint. Both new and existing-game previews use the **same privacy-safe input policy** in the extracted service: no implicit BGG user-collection request, the same Thing and local snapshot fields, algorithm version and score; the HTTP route may show more detail but cannot silently compute a different estimate. Include input-source/version identity in both projections so a later explicit refresh or local revision is distinguishable from a calculation shown earlier in chat.

Existing `predictBggGame` short-circuits on the first primary BGG ID and otherwise builds a temporary game with `ownership: "owned"`. Distinguish that synthetic value from actual ownership. Check primary **and additional** collection BGG IDs, report multiple matches as ambiguous, and use the matched game's actual ownership/current score or prediction (including previously owned), rather than present a new-game estimate. Preserve score-source labels and Stage 0 readiness. Do not present stored imported metadata as freshly observed BGG facts. After checking ID permission and local collection matches, request Thing verification even for an existing match when BGG is available. If Thing fails, an existing match may return `existing-local-unverified` with only current local identity/score/ownership evidence and a separate BGG failure status; **no** fresh BGG name, year, mechanic, type or external-game claim follows. If no local match and Thing fails, return unavailable with no score. Multiple local matches stay ambiguous regardless of Thing success. A successful Thing response must match the requested ID/type before BGG facts or a new-game estimate is returned. Local-only score citations remain usable independently of unavailable BGG facts.

The current `getGame()` implicitly fetches BGG collection data and can contribute play-derived prediction inputs. The extracted Thing-only path must not fetch it merely for numerical parity. **Migrate the route to that same source policy**, recording any intentional regression in old play-derived preview inputs and updating route fixtures. Under the same snapshot/Thing observation, the route and Analyst projections must have identical numeric estimate, readiness and source version. A later independent route request may reflect a changed BGG observation or local snapshot: show its calculation time/source versions rather than imply its score is the historical chat estimate. Opening an already emitted Analyst card reuses its calculation and never calls the route. No persistent game, wishlist, note, setting, or search history write occurs.

## Provenance, final answer and transport

Increment the Analyst manifest and contract versions when adding tool/result, evidence, disclosure and stream fields. Manifest entries specify the **allowed model-visible projection** per tool, not generic BGG responses. Add evidence classes for search observation, Hot observation, BGG candidate identity, Thing facts, and local preview calculation; preserve collection/owner-note classes. Search/Hot observation citations exist even on zero results and resolve to an ephemeral discovery-results panel in the conversation. Candidate/Thing citations resolve to daemon-built canonical `https://boardgamegeek.com/boardgame/{id}` destinations. Preview citations resolve to a versioned local calculation panel with its associated Thing/collection source identities, not to a fabricated BGG rating. All evidence records are turn-scoped and include server-owned IDs, source version, observed/calculated time, coverage and safe destination; model input may contain only their opaque citation IDs. Year/mechanic claims require Thing, Hot membership requires that turn's Hot observation, and collection scoring requires local evidence. Citation validation proves inspected provenance, **not** semantic truth of every sentence.

Replace freeform finalization for Analyst with the grounded structured submission tool carrying conversational text blocks, model-selected citation IDs, outcome and optional view references. Resolve each ID against the actual current-turn registry, construct complete citations server-side, reject unknown/stale/destination-mismatched references and preserve source-change handoff checks. Reflections retain their existing submission manifest. Do not trust model-created URLs, citations, timestamps, or HTML; constrain links in rendered answer prose to daemon-approved destinations (or render non-citation links as plain text). No raw BGG content may alter policy or tool permissions.

Extend the existing Analyst turn stream, result, and web/CLI decoding with optional daemon-authored `discovery` groups and `fitnessPreview` cards adjacent to the answer they support. View data is bounded and correlated to evidence IDs; the final result is terminal and atomic. The owner may inspect a candidate, choose/correct an ambiguous identity in a subsequent message, or open a read-only preview without adding it. Discovery and preview cards remain ephemeral in the current conversation; previous answer prose is historical context, not fresh evidence. Old citations can display their historical observation time without making a background BGG call; inspector semantics must distinguish historical, superseded and currently verified. Keep existing stale owner-note checks.

For follow-up identity references, add optional `discoveryReceipts: string[]` (maximum 20, bounded token length) to the strict `AnalystTurnRequestSchema`, outside `messages`; return the receipts alongside finalized emitted candidates in the terminal Analyst result, never as tool output to the model. Each opaque authenticated receipt encodes schema version, conversation ID, originating turn index, originating assistant attestation digest, exact emitted positive-safe-integer ID, and source kind (`search` or `hot`); sign with the daemon's existing attestation key facility and domain-separate from note attestations. A receipt is issued **only for a finalized turn**, after that turn's attested assistant message exists; none is issued for cancelled/failed turns. On a subsequent turn accept only valid signatures, matching conversation ID, an earlier turn index in the submitted alternating transcript, matching originating attestation digest at that index, supported receipt schema, and IDs actually emitted by the attested result; reject malformed/replayed-to-another-conversation receipts before model invocation, cap accepted IDs, and never log their payload. The per-result digest must authenticate the emitted-ID list (not just prose) so a forged client cannot attach a valid token to an un-emitted ID. Manifest/disclosure upgrades do not silently invalidate an identity-only receipt, but the **current** disclosure acknowledgment is mandatory before any new BGG call. The receipt grants only lookup eligibility; current facts, Hot membership and fitness require newly model-invoked tools and new turn-local evidence. No daemon conversation cache or durable BGG ID store.

## Tool outcomes versus terminal failures

Tool results use a strict discriminated status, never a thrown raw BGG error serialized to the model. Successful empty title search/Hot sample is `ok` with a zero-count observation citation. A partially successful Thing batch is `partial` with citations only for verified successful IDs and per-ID bounded error codes for failed IDs; no fabricated failure citation. Invalid query/span/ID, not-configured or unauthorized BGG, throttled/queued-timeout/outage/parse failure, **per-tool** budget/timeout, and unavailable prediction are typed `error` or `unavailable` **tool results** if the turn remains live, allowing the model to produce a qualified `partial`/`abstained` final answer. Stage 0 is a successful preview computation with `predictionUnavailable: stage-0`, not a BGG failure and not a zero score. An existing local-only score with failed Thing is a partial preview with `state: existing-local-unverified` and `bggLookup: {status: failed, errorCode}`, as defined above. Failure cards carry source operation, safe error code and retryability, never a bogus observation time/zero count.

The shared terminal `unavailable` remains for failure to capture/revalidate authorized local evidence, model configuration/authentication/rate-limit/outage/refusal, extension binding, output validation, or turn transport/internal errors; use the existing corresponding `AnalystUnavailableReasonSchema` values. BGG auth/429/outage is **not** mapped to provider `authentication`/`rate-limit`/`provider-outage`: those enums refer to provider terminal failure, while BGG errors remain tool-level codes. Owner stop/disconnect produces the existing cancelled terminal path, not a final answer. The **global 120-second turn deadline** aborts the active provider and tool signals, suppresses any late submission, and terminates as `unavailable` with reason `transport` and a safe `turn-deadline` detail; it is never a recoverable tool result. If every tool fails but the provider can still submit before that deadline, the final outcome is `abstained` with an explicit BGG limitation; if some inspected evidence supports only a narrower claim, use `partial`. If the provider then fails, report its terminal reason and do not publish an unfinished assistant answer. Do not expand terminal enums merely to mislabel BGG tool outcomes.

## Owner experience and disclosure

Keep the existing transcript/composer pattern in `packages/web/components/analyst-chat.tsx`. Render compact source-labeled discovery groups next to the explanation: `BGG title matches` or `BGG Hot sample`, observation time, number emitted versus returned, truncation/partial coverage, and candidate title/ID/year only if known. Candidate links use the server-owned BGG item destination. When identity is ambiguous, present alternatives for inspection and a clear prompt to choose/correct in chat; do not silently select one. Separate local **Predicted fitness** from BGG facts and from an **Existing in collection** current actual/predicted score. Show readiness/confidence when present, bounded axis/source and reference identities in an expandable read-only panel, and an explicit unavailable state instead of zero. No advanced-search/year/mechanic filter UI, buy/save action or extra network call on opening a card. For broader catalogue discovery, a plain BGG advanced-search pointer may be offered without claiming XML API support.

On narrow screens stack details, wrap names/IDs, and keep actions keyboard-operable with visible focus and accessible labels. Use headings and text provenance rather than color alone; retain 44px targets and 16px composer text. Announce concise progress/terminal errors in the existing polite region without repeating entire cards. Distinguish “no matches in this title search,” “no useful candidates in this checked Hot sample,” partial coverage, identity ambiguity, missing facts, missing auth, throttling/outage, and prediction unavailability. Retry is explicit owner action, never automatic provider replay. The CLI renders the same distinctions as text and canonical links where supported.

Before first send, explicitly disclose that a selected owner title or BGG ID may go to BGG; Hot sends a fixed request and selected IDs, not owner chat/collection/notes. BGG facts and selectively authorized collection evidence may go to the configured model provider under its policy; BGG processing is separate. Bind acknowledgment to a changed disclosure/manifest policy version in addition to provider/model so prior acknowledgment does not cover new outbound behavior. BGG's token remains daemon-only. Operational logs may record operation kind, duration, count and outcome, but **not** query text, IDs, transcript, raw BGG body, provider payload, or token. Audit `bgg-client.ts` URL/error/query logging and force Analyst content tracing off even if an environment tracing toggle is enabled. Do not durably store BGG searches, returned IDs, preview data or transcript.

## Verification seams

- Contract tests: strict inputs and result byte/count caps, manifest/version/disclosure acknowledgment, provider tool allowlist (including Reflection exclusion), schema parsing on web/CLI, model never receives collection fingerprints/internal receipts/raw BGG response.
- Deterministic turn tests: any-order/zero tool use, owner-title spans, bare confirmation rejection, explicit and emitted/receipt IDs versus invented/collection-derived IDs, zero-hit observation citation, Hot partial/truncated sample, unknown/mismatched/non-boardgame Thing, absent year/mechanics and ambiguous collection matches.
- BGG client fixtures: fixed Hot URL, no hidden thumbnail or collection fetch, authentication/202/429/5xx/401 and request-attempt cap, queued/active/backoff/body aborts, no raw query/ID/token in logs. Extend `bgg-client.test.ts` and Analyst turn-boundary tests.
- Preview parity fixtures: compare the extracted route and Analyst calculation under identical Thing/local inputs; Stage 0, owned/previously-owned/additional-ID/multi-match paths, local source change, actual versus predicted labels, no persistent writes; extend prediction service/route tests.
- Final/transport UI fixtures: forged citations/links and BGG prompt injection, change Hot/Thing/local versions across turns, follow-up receipts and historical inspector, cancellation at each tool/final response, no completed cancelled answer, web/CLI empty/partial/unavailable states and accessible narrow layout. Verify no provider retry and no Reflection BGG permission.

## External terms and accepted risk

The official [BGG XML API2 wiki](https://boardgamegeek.com/wiki/page/XML_API2), [API usage page](https://boardgamegeek.com/using_the_xml_api), and [terms](https://boardgamegeek.com/terms) challenged automated inspection on 2026-09-25. Unauthenticated API requests returned 401 pointing at the usage page. Current precise auth rules, numerical rate limits, caching/retention rights and permission for model-assisted use were **not verifiable** from accessible first-party text. The 5-second client delay, retry counts and 30-second fetch timeout are **existing application policy**, not official BGG limits. For this personal-use, bounded-request project, the owner accepts that uncertainty rather than blocking implementation on a terms check. This is not a claim that personal use is exempt or that BGG has authorized model-assisted use. Preserve authentication, pacing, finite budgets, read-only behavior and no durable BGG cache; revisit first-party guidance when accessible, and stop/reassess if an explicit restriction or API refusal applies. Do not substitute scraping for the authorized API. No speculative official quota or retention assertion enters the UI.

Two consciously limited design choices remain: owner-message spans enforce origin but not natural-language *title semantics*; and Thing-only previews may differ from the old route if it used BGG collection-derived play data. Both are exposed above with enforceable gates and parity tests, not deferred to implementers as hidden assumptions. Product may later require explicit owner title selection, but this version does not add an intent gate.
