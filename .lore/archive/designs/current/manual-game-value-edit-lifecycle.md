---
title: Manual game value edit lifecycle
date: 2026-08-29
status: implemented
tags: [design, forms, manual-values, concurrency]
modules: [web, daemon, shared]
related: [.lore/work/notes/shelf-judge-e05.md]
---

# Manual game value edit lifecycle

## Decision

Play Time and Player Count are independent corrections with independent drafts and controls. Each field has its own save and clear controls, and every request mutates exactly one field. The edited field is disabled while its request is pending. The other field's draft remains editable, but the form serializes mutations: no second save or clear may start until the pending request and its route refresh settle. This prevents two successful requests from producing out-of-order route snapshots without adding revision machinery.

Separate browser sessions use last-write-wins behavior. This feature does not add optimistic concurrency because the daemon mutation contract has no expected revision or conflict response. If stale-write rejection becomes a requirement, it must be added at the daemon boundary rather than simulated in client state.

## Field State

Each field owns:

- `draft`: the text currently shown in the input.
- `baseline`: the latest server value known to the field.
- `status`: `idle`, `saving`, `clearing`, or `refreshing`. At most one field may be non-idle.
- `error`: the latest field-specific failure, or null.

A field is dirty when `draft !== baseline`. Valid positive safe integers may be saved. A nonempty invalid draft remains visible but cannot be submitted. Clear is available when the effective manual baseline exists and the form has no pending mutation.

## Transitions

| Event                                              | Required behavior                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User edits an idle field                           | Update its draft and clear its prior error.                                                                                                                                                          |
| User saves                                         | Send only that field, capture the submitted value, disable that field, and prevent either field from starting another mutation until settlement and refresh. The other draft remains editable.       |
| User clears                                        | Send only that field as null, retain its current draft while pending, disable that field, and prevent another mutation from starting. A dirty pre-clear draft remains retained for failure recovery. |
| Server props refresh while field is clean and idle | Adopt the server value as draft and baseline. A newer confirmation identity is a refresh even when its scalar matches the prior prop.                                                                |
| Server props refresh while field is dirty and idle | Preserve the draft and update the baseline, including for a newer confirmation identity with the same scalar.                                                                                        |
| Server props refresh while field is pending        | Preserve the draft; retain the newest server value as the baseline available after settlement, keyed by scalar and provenance rather than scalar alone.                                              |
| Save succeeds                                      | Set draft and baseline to the submitted value, clear the error, enter `refreshing`, and start an authoritative route refresh as a React transition.                                                  |
| Clear succeeds                                     | Set draft and baseline to empty, clear the error, enter `refreshing`, and start an authoritative route refresh as a React transition.                                                                |
| Route refresh settles                              | Return the form to idle. Refreshed props reconcile through the normal clean/dirty rules before another mutation can start.                                                                           |
| Save fails                                         | Preserve the submitted draft, retain the newest known server baseline, expose a retryable field error, and return to idle.                                                                           |
| Clear fails                                        | Preserve the exact pre-clear draft, including a dirty draft, retain the newest known server baseline, expose a retryable field error, and return to idle.                                            |

No transition infers whether an edit happened during a request because editing the pending field is not permitted. Serialization lasts through route refresh completion so an earlier snapshot cannot arrive after a later mutation. The implementation uses React `useTransition`: successful mutation handling calls `startTransition(() => router.refresh())`, and the form-level lock is released when `isPending` returns to false after having entered `refreshing`. The injectable content seam follows the same transition around its supplied refresh callback; it does not pretend that `router.refresh()` returns a promise.

## Accessibility

Each field has its own status/error element. The input and its save/clear controls reference that element with `aria-describedby`. Errors use an assertive live region such as `role="alert"`. Saving and clearing expose operation-specific button text and a polite live status so assistive technology receives the pending outcome. Disabled controls alone are not the status indication.

## API Contract

The existing strict mutation body remains suitable:

```json
{ "playingTime": 90 }
```

```json
{ "playerCount": null }
```

The web client must not send both fields in one request. Omitted fields remain unchanged. Successful writes continue returning the updated game, although the first implementation may refresh the route after success rather than consume that response directly.

## Validation

Automated interaction tests must prove:

- saving Play Time sends no Player Count property, and vice versa;
- clearing either field sends only that field;
- a pending field's input and controls are disabled, the other draft remains editable, and neither field can start another mutation;
- a failed request preserves the draft and can be retried;
- refreshed props update a clean field;
- refreshed props preserve a dirty field while advancing its baseline;
- refreshed props during a pending request cannot replace its submitted draft;
- successful save and clear establish the new baseline without changing the other field.
- successful save and clear observe a newer authoritative confirmation whose scalar matches the pre-mutation prop;
- a failed clear preserves the exact pre-clear draft across an intervening prop refresh;
- status and error messages are programmatically associated with the affected field and announced;
- the serialized form cannot produce overlapping requests or out-of-order self-initiated refreshes.

## Deferred Conflict Protection

True stale-write protection would require an expected field version, confirmation timestamp, or collection revision in the mutation request and a daemon `409 Conflict` response containing current state. Client-side revision counters cannot provide that guarantee and are intentionally excluded.
