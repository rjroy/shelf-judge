# Native provider transport diagnostics

Ollama's built-in provider delegates to Pi's official `openai-completions` adapter. It does not replace Pi retries, timeout construction, cancellation, payload hooks, response hooks, or SSE parsing. The diagnostic fetch only records redacted transport boundaries before Pi can reduce a native error to `Request timed out`.

The Ollama diagnostic fetch explicitly passes Bun's supported `timeout: false` option. This disables Bun's native HTTP timeout for this transport only, including while awaiting headers and reading a stream. Pi's supplied abort signal and configured deadline remain the authoritative cancellation and timeout controls. No application timer or retry policy is added, and other fetch users, including BGG, retain their existing behavior.

The runtime behavior is pinned to Bun v1.3.11 source: [fetch.zig](https://github.com/oven-sh/bun/blob/bun-v1.3.11/src/bun.js/webcore/fetch.zig). Its timeout parser documents `// timeout: false | number | undefined` and, for a boolean, sets `disable_timeout` to `!timeout_value.asBoolean()`. Therefore `timeout: false` disables Bun's native HTTP timeout; it does not remove the supplied `AbortSignal`.

The default trace record for a header-phase failure has this shape (the normal trace identity fields are retained):

```json
{
  "recordType": "grounded-model-trace",
  "event": "provider-transport",
  "operationId": "operation-1",
  "batchId": "batch-1",
  "requestId": "request-1",
  "roundIndex": 1,
  "durationMs": 1000,
  "transport": {
    "phase": "awaiting-headers",
    "outcome": "failed",
    "url": "http://127.0.0.1:11434/v1",
    "abort": { "aborted": false }
  },
  "failure": {
    "primary": { "name": "Error", "message": "Request timed out" },
    "causeChain": [
      { "name": "TimeoutError", "message": "socket timed out", "code": "UND_ERR_CONNECT_TIMEOUT" }
    ]
  }
}
```

`headers-received` records status and receipt time. `reading-body` records completion, cancellation, or the original read error, with the elapsed idle time before that boundary. Every terminal body record captures the live request signal state. A `cancelled` body outcome with `abort.aborted: false` is a consumer cancellation, not attributed to Pi or a caller. URLs omit credentials, query strings, and fragments. Headers, request bodies, response bodies, prompts, and streamed content are never logged. Error details and abort reasons use the existing bounded redaction schema.

These records show what the transport wrapper observed. They do not attribute a timeout to the SDK, runtime, server, or network unless the observed native error chain states that evidence.
