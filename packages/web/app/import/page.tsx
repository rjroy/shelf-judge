"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ImportProgress {
  imported: number;
  total: number;
  current: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function ImportPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || importing) return;

    setImporting(true);
    setProgress(null);
    setResult(null);
    setError(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/daemon/import/bgg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(data.error ?? `Import failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        // Standard SSE parsing: accumulate fields, dispatch on blank line
        let eventType = "";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          } else if (line.startsWith(":")) {
            // SSE comment, ignore
          } else if (line === "") {
            // Blank line: dispatch the accumulated event
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine);
                if (eventType === "progress") {
                  setProgress(parsed);
                } else if (eventType === "complete") {
                  setResult(parsed);
                } else if (eventType === "error") {
                  setError(parsed.error);
                }
              } catch {
                // Skip unparseable data
              }
            }
            eventType = "";
            dataLine = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Import from BoardGameGeek</div>
      </div>

      <div className="main-scroll">
        <div className="import-content">
          {/* Pre-import: username form */}
          {!importing && !result && (
            <>
              <div className="import-header">
                <h2>Import Collection</h2>
                <p>
                  Import your owned games from a BoardGameGeek collection. Enter your BGG username
                  to get started.
                </p>
              </div>

              <form onSubmit={handleImport} className="import-form">
                <input
                  className="form-input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="BGG username"
                  disabled={importing}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={importing}>
                  Import
                </button>
              </form>
            </>
          )}

          {error && <div className="error-banner">{error}</div>}

          {/* Importing state */}
          {importing && progress && (
            <>
              <div className="import-header">
                <h2>Importing Collection</h2>
                <p>
                  Fetching game data from BGG for <strong>{username}</strong>. This may take a
                  moment — BGG requests are rate-limited.
                </p>
              </div>

              {/* Status banner */}
              <div className="status-banner running">
                <div className="status-icon">⟳</div>
                <div className="status-text">
                  <div className="status-headline">Importing in progress</div>
                  <div className="status-sub">
                    {progress.current
                      ? `Fetching ${progress.current} from BGG…`
                      : progress.total > 0
                        ? "Fetching game data from BGG…"
                        : "Fetching collection list…"}
                  </div>
                </div>
                <div className="status-count">
                  <div className="count-value">
                    {progress.imported} / {progress.total}
                  </div>
                  <div className="count-label">games</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="progress-section">
                <div className="progress-header">
                  <div className="progress-label">Progress</div>
                  <div className="progress-fraction">
                    {progress.imported} of {progress.total}
                    {progress.total > 0 &&
                      ` · ${Math.round((progress.imported / progress.total) * 100)}%`}
                  </div>
                </div>
                <div className="progress-track">
                  {/* Dynamic width: progress percentage computed from runtime import count */}
                  <div
                    className="progress-fill"
                    style={{
                      width:
                        progress.total > 0
                          ? `${(progress.imported / progress.total) * 100}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>

              <p className="import-throttle-note">
                BGG requests are throttled to avoid rate limiting. Please keep this window open
                until the import finishes.
              </p>
            </>
          )}

          {/* Completion summary */}
          {result && (
            <>
              <div className="import-header">
                <h2>Import Complete</h2>
                <p>
                  Finished importing games from BGG for <strong>{username}</strong>.
                </p>
              </div>

              <div className="summary-block">
                <div className="status-headline">Import Summary</div>
                <div className="summary-stats">
                  <div className="summary-stat">
                    <div className="summary-stat-value added">{result.imported}</div>
                    <div className="summary-stat-label">Added</div>
                  </div>
                  <div className="summary-stat">
                    <div className="summary-stat-value skipped">{result.skipped}</div>
                    <div className="summary-stat-label">Skipped</div>
                  </div>
                  <div className="summary-stat">
                    <div className="summary-stat-value errors">{result.errors.length}</div>
                    <div className="summary-stat-label">Errors</div>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="error-banner error-banner-mb">
                  {result.errors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}

              <button className="btn btn-primary" onClick={() => router.push("/")}>
                Go to Collection
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
