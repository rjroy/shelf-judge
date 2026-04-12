import { NextRequest, NextResponse } from "next/server";
import { daemonRequest } from "@/lib/daemon";

async function proxyToDaemon(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const daemonPath = `/api/${path.join("/")}`;
  const url = new URL(request.url);
  const fullPath = `${daemonPath}${url.search}`;

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? ((await request.json().catch(() => undefined)) as unknown)
      : undefined;

  try {
    const { response, isStream } = await daemonRequest(fullPath, {
      method: request.method,
      body,
    });

    if (isStream) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const responseBody = await response.text();
    const headers = new Headers();
    response.headers.forEach((value, key) => {
      if (!["connection", "keep-alive", "transfer-encoding"].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });
    if (!headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    return new NextResponse(responseBody, {
      status: response.status,
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

export async function PATCH(
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
