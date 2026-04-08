"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ImportProgress, ImportComplete } from "@shelf-judge/shared";

function progressStatusText(progress: ImportProgress): string {
  if (progress.current) return `Fetching ${progress.current} from BGG…`;
  if (progress.total > 0) return "Fetching game data from BGG…";
  return "Fetching collection list…";
}

export default function ImportPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportComplete | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // On page load, fetch the saved username from config to pre-fill the form
  useState(() => {
    fetch("/api/daemon/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.username) {
          setUsername(data.username);
        }
      })
      .catch(() => {
        // Ignore errors, just leave the form blank
      });
  });

  async function handleSaveUsername() {
    if (!username.trim()) return;

    try {
      await fetch(`/api/daemon/config?username=${encodeURIComponent(username.trim())}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      setError(null);
      alert("Username saved successfully!");
    } catch {
      setError("Failed to save username in config. Please try again.");
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || importing) return;

    setImporting(true);
    setProgress(null);
    setResult(null);
    setError(null);

    abortRef.current = new AbortController();

    try {
      await fetch(`/api/daemon/config?username=${encodeURIComponent(username.trim())}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
    } catch {
      setError("Failed to set username in config. Please try again.");
      setImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/daemon/import/bgg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Import failed" }))) as {
          error?: string;
        };
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
                const parsed: unknown = JSON.parse(dataLine);
                if (eventType === "progress") {
                  setProgress(parsed as ImportProgress);
                } else if (eventType === "complete") {
                  setResult(parsed as ImportComplete);
                } else if (eventType === "error") {
                  setError((parsed as { error: string }).error);
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

              <form
                onSubmit={(e) => {
                  void handleImport(e);
                }}
                className="import-form"
              >
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
                <button type="button" className="btn btn-secondary" onClick={() => handleSaveUsername()} disabled={importing}>
                  Save Username Only
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
                  <div className="status-sub">{progressStatusText(progress)}</div>
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
