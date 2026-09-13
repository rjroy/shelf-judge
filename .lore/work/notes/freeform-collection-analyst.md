# Freeform Collection Analyst Provider Fixture Migration

## Rationale

Analyst completes with ordinary assistant text after optional evidence reads. It does not submit the generic structured-analysis tool. The prior provider fixture modeled both protocols with a growing mode union and inferred the next response from accumulated session state. That made an unexpected model request capable of being answered as a valid later turn.

`packages/daemon/tests/analyst-freeform-provider.test.ts` now uses a finite OpenAI SSE script. Each request consumes one explicit step containing its expected tool visibility and bounded request markers plus either one tool call, one terminal text response, or one terminal HTTP error. A mismatch is recorded and gets an HTTP 400 response. The fixture stores only pathname and visible tool names, aborts pending work, force-stops the server, and asserts full script consumption. It never stores a request transcript or contains role-guessing/retry behavior.

## Coverage migration

| Previous coverage in `grounded-analysis-provider.test.ts` | New freeform protocol coverage |
| --- | --- |
| Real Ollama SSE Analyst read followed by plain final text | retrieval then plain terminal answer |
| `analyst-retrieve-then-submit` | retrieval then plain terminal answer, with submission tool absent |
| `analyst-multi-page` | two explicit `readGames` calls then plain terminal answer |
| Provider terminal failure behavior | single scripted HTTP 400 terminal error |
| Plain final text behavior | direct final, empty final, and length final scripts |
| Analyst handoff error/source-change mapping | typed `analyzeFreeform` provider fakes in `grounded-analysis-provider.test.ts` |

The old fixture retains a pre-`structuredClone` finite request guard. Its default expected sequence is derived from the existing generic mode under test, including the twenty-five-retrieval scenario's twenty-six requests; the explicit zero-request regression verifies that overflow terminates before recording or cloning a request. It remains responsible for generic structured submission, reflection, adversarial tool boundaries, and the long twenty-five-turn structured sequence. The synthetic Analyst structured submission and unknown-citation mode were removed because they do not represent the Analyst runtime. Citation validation remains covered by the dedicated Analyst validator and evidence tests.

The freeform fixture also has an explicit two-step script whose attempted third request records `step 3: unexpected request after script completion` and receives HTTP 400. The test asserts that the caller observes a transport failure, rather than receiving another successful tool-use response.

## Validation status

Validation is intentionally paused at the user's direction after the provider fixture caused resource pressure. This architecture has received static review: freeform audit identity is not asserted as model payload, empty terminal text is treated as a no-response failure, and the script-exhaustion guard runs before request-body parsing. No tests, typecheck, lint, build, browser run, or reproduction was executed for this edit. Any prior passing results predate this migration and do not validate it. The only permitted follow-up check is a static review and `git diff --check`.

## Remaining migration gaps

The generic local provider fixture is still a mode-based state machine and needs separate cleanup. This change isolates only the Analyst freeform path and deliberately does not alter Analyst runtime code, reflection coverage, or existing follow-up-route coverage.
