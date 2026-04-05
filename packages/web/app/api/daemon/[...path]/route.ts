import { NextRequest, NextResponse } from "next/server";

const SOCKET_PATH = process.env.SHELF_JUDGE_SOCKET ?? "/tmp/shelf-judge.sock";
const DAEMON_BASE = "http://localhost";

async function proxyToDaemon(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
) {
  const { path } = await params;
  const daemonPath = `/api/${path.join("/")}`;
  const url = new URL(request.url);
  const queryString = url.search;
  const fullPath = `${DAEMON_BASE}${daemonPath}${queryString}`;

  const headers: Record<string, string> = {};
  if (request.headers.get("content-type")) {
    headers["Content-Type"] = request.headers.get("content-type")!;
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    // @ts-expect-error Bun extension for unix socket transport
    unix: SOCKET_PATH,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  const res = await fetch(fullPath, init);

  // For SSE responses, stream them through
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyToDaemon(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyToDaemon(request, context.params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyToDaemon(request, context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyToDaemon(request, context.params);
}
