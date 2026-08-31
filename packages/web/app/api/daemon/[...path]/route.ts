import { NextRequest, NextResponse } from "next/server";
import { proxyDaemonRequest, type DaemonRequest } from "@/lib/daemon-proxy";

export async function proxyToDaemon(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
  requestDaemon?: DaemonRequest,
) {
  const { path } = await params;
  const daemonPath = `/api/${path.join("/")}`;
  const url = new URL(request.url);
  const fullPath = `${daemonPath}${url.search}`;

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? ((await request.json().catch(() => undefined)) as unknown)
      : undefined;

  const response = await proxyDaemonRequest(
    { path: fullPath, method: request.method, body, signal: request.signal },
    requestDaemon,
  );
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
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
