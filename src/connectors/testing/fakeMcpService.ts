import { ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface FakeMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface FakeMcpRequest {
  method: string;
  url: string;
  token: string | null;
  sessionId: string | null;
  rpcMethod: string | null;
  params: Record<string, unknown> | undefined;
}

type CallHandler = (name: string, args: unknown) => Record<string, unknown>;

interface JsonRpcMessage {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const PAGE_SIZE = 2;
const PROGRESS_NOTIFICATION = JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/message",
  params: { level: "info", data: "working" },
});

export class FakeMcpService {
  readonly requests: FakeMcpRequest[] = [];
  readonly validTokens = new Set<string>();
  tools: FakeMcpTool[] = [];
  answer: CallHandler = (name) => ({ content: [{ type: "text", text: `ran ${name}` }] });
  repliesWithEventStream = false;
  unreachable = false;
  hangs = false;
  failWithStatus: number | null = null;
  failBody = "Service error";
  private sessions = new Set<string>();
  private issuedSessions = 0;

  constructor(readonly url: string) {}

  readonly fetch: FetchLike = async (url, init) => {
    if (this.unreachable) throw new ServiceUnreachableError(String(url), new TypeError("offline"));
    if (this.hangs) return new Promise<Response>(() => {});
    const headers = new Headers(init?.headers);
    const message =
      typeof init?.body === "string" ? (JSON.parse(init.body) as JsonRpcMessage) : null;
    const sessionId = headers.get("mcp-session-id");
    this.requests.push({
      method: init?.method ?? "GET",
      url: String(url),
      token: /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null,
      sessionId,
      rpcMethod: message?.method ?? null,
      params: message?.params,
    });
    if (String(url) !== this.url) return new Response("Not found", { status: 404 });
    if (this.failWithStatus) return new Response(this.failBody, { status: this.failWithStatus });
    const token = this.requests[this.requests.length - 1].token;
    if (!token || !this.validTokens.has(token)) {
      return new Response('{"error":"invalid_token"}', { status: 401 });
    }
    if (!message) return new Response(null, { status: 405 });
    if (message.method === "initialize") {
      const issued = `session-${++this.issuedSessions}`;
      this.sessions.add(issued);
      return this.reply(
        message.id,
        { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
        {
          "mcp-session-id": issued,
        }
      );
    }
    if (!sessionId || !this.sessions.has(sessionId)) {
      return new Response("Session not found", { status: 404 });
    }
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === "tools/list") {
      const start = Number(message.params?.cursor ?? 0);
      const next = start + PAGE_SIZE;
      return this.reply(message.id, {
        tools: this.tools.slice(start, next),
        ...(next < this.tools.length ? { nextCursor: String(next) } : {}),
      });
    }
    if (message.method === "tools/call") {
      const params = message.params ?? {};
      if (!this.tools.some((tool) => tool.name === params.name)) {
        return this.reply(message.id, undefined, {}, { code: -32602, message: "Unknown tool" });
      }
      return this.reply(message.id, this.answer(String(params.name), params.arguments));
    }
    return this.reply(message.id, undefined, {}, { code: -32601, message: "Method not found" });
  };

  expireSessions(): void {
    this.sessions.clear();
  }

  callsOf(rpcMethod: string): FakeMcpRequest[] {
    return this.requests.filter((request) => request.rpcMethod === rpcMethod);
  }

  private reply(
    id: number | undefined,
    result: unknown,
    headers: Record<string, string> = {},
    error?: { code: number; message: string }
  ): Response {
    const body = JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) });
    if (this.repliesWithEventStream) {
      const events = `event: message\ndata: ${PROGRESS_NOTIFICATION}\n\nevent: message\ndata: ${body}\n\n`;
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode(events)),
      });
      return new Response(stream, {
        status: 200,
        headers: { ...headers, "content-type": "text/event-stream" },
      });
    }
    return new Response(body, {
      status: 200,
      headers: { ...headers, "content-type": "application/json" },
    });
  }
}
