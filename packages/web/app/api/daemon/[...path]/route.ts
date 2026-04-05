import { NextRequest, NextResponse } from "next/server";
import { daemonFetch, daemonFetchStream } from "@/lib/daemon";

async function proxyToDaemon(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const daemonPath = `/api/${path.join("/")}`;
  const url = new URL(request.url);
  const fullPath = `${daemonPath}${url.search}`;

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await request.json().catch(() => undefined)
      : undefined;

  try {
    // Use streaming for SSE-capable endpoints, buffered for everything else
    const res = await daemonFetch(fullPath, { method: request.method, body });

    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      // Re-request with streaming for SSE
      const streamRes = await daemonFetchStream(fullPath, { method: request.method, body });
      return new NextResponse(streamRes.body, {
        status: streamRes.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const responseBody = await res.text();
    const headers = new Headers();
    res.headers.forEach((value, key) => {
      // Skip hop-by-hop headers that shouldn't be forwarded
      if (!["connection", "keep-alive", "transfer-encoding"].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });
    if (!headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    return new NextResponse(responseBody, {
      status: res.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "Daemon unavailable" }, { status: 502 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToDaemon(request, context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToDaemon(request, context.params);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyToDaemon(request, context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyToDaemon(request, context.params);
}
