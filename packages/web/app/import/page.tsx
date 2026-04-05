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

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === "progress") {
                setProgress(parsed);
              } else if (eventType === "complete") {
                setResult(parsed);
              } else if (eventType === "error") {
                setError(parsed.error);
              }
            } catch {
              // Skip unparseable lines
            }
            eventType = "";
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
    <div>
      <h1>Import from BGG</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Import your owned games from a BoardGameGeek collection. Enter your BGG
        username to get started.
      </p>

      <form onSubmit={handleImport} style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="BGG username"
          disabled={importing}
          required
          style={{
            padding: "8px 12px",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 14,
            marginRight: 8,
          }}
        />
        <button
          type="submit"
          disabled={importing}
          style={{
            padding: "8px 16px",
            backgroundColor: importing ? "#999" : "#059669",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: importing ? "default" : "pointer",
            fontSize: 14,
          }}
        >
          {importing ? "Importing..." : "Import"}
        </button>
      </form>

      {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}

      {importing && progress && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 600 }}>
            Importing {progress.imported} of {progress.total}...
          </p>
          {progress.current && (
            <p style={{ color: "#666", fontSize: 14 }}>
              Current: {progress.current}
            </p>
          )}
          <div
            style={{
              width: "100%",
              maxWidth: 400,
              height: 8,
              backgroundColor: "#e0e0e0",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: progress.total > 0
                  ? `${(progress.imported / progress.total) * 100}%`
                  : "0%",
                height: "100%",
                backgroundColor: "#059669",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {result && (
        <div
          style={{
            padding: 16,
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Import Complete</h2>
          <p>
            <strong>{result.imported}</strong> game{result.imported === 1 ? "" : "s"} imported
          </p>
          {result.skipped > 0 && (
            <p style={{ color: "#666" }}>
              {result.skipped} game{result.skipped === 1 ? "" : "s"} skipped
              (already in collection)
            </p>
          )}
          {result.errors.length > 0 && (
            <div>
              <p style={{ color: "#c00" }}>
                {result.errors.length} error{result.errors.length === 1 ? "" : "s"}:
              </p>
              <ul style={{ color: "#c00", fontSize: 13 }}>
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => router.push("/")}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Go to Collection
          </button>
        </div>
      )}
    </div>
  );
}
