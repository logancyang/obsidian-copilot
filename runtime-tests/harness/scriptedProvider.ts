import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * What the provider should answer the next chat-completion request with.
 *
 * `hold` streams its text and then keeps the response open until the client
 * aborts, which is how a turn stays in flight long enough to be cancelled.
 */
export type ScriptedReply =
  | { kind: "text"; text: string }
  | { kind: "hold"; text: string }
  | { kind: "toolCall"; name: string; arguments: Record<string, unknown> };

/** One chat-completion request as the agent actually sent it. */
export interface RecordedRequest {
  url: string;
  model: string;
  /** The raw JSON body, for assertions the named fields don't cover. */
  body: Record<string, unknown>;
}

/**
 * A localhost OpenAI-compatible endpoint that answers from a script.
 *
 * It replaces remote inference and nothing else: the agent reaches it through
 * its own `@ai-sdk/openai-compatible` adapter over real HTTP, configured by
 * production `buildOpencodeConfig`.
 */
export class ScriptedProvider {
  #server: http.Server | null = null;
  #port = 0;
  readonly #replies: ScriptedReply[] = [];
  readonly #recorded: RecordedRequest[] = [];
  readonly #open = new Set<http.ServerResponse>();

  /** Base URL to store on the Copilot provider row (`.../v1`). */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}/v1`;
  }

  /** Chat-completion requests received so far, oldest first. */
  get requests(): readonly RecordedRequest[] {
    return this.#recorded;
  }

  /** Queue replies, consumed one per chat-completion request, in order. */
  reply(...replies: ScriptedReply[]): void {
    this.#replies.push(...replies);
  }

  async start(): Promise<void> {
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
    const server = this.#server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.#port = (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const res of this.#open) res.destroy();
    this.#open.clear();
    const server = this.#server;
    this.#server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? "";
    if (!url.includes("/chat/completions")) {
      // The adapter probes `/models` on some paths; anything else is a 404 the
      // scenario will see as a failed turn rather than a silent hang.
      res.writeHead(url.includes("/models") ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
      return;
    }

    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "";
    this.#recorded.push({ url, model, body });

    // opencode names a conversation with a second, tool-less completion call.
    // It must not consume the reply scripted for the turn, and a scenario never
    // asserts on the title, so it gets a fixed answer.
    const isAgentTurn = Array.isArray(body.tools);
    const reply: ScriptedReply = !isAgentTurn
      ? { kind: "text", text: "Runtime scenario" }
      : (this.#replies.shift() ?? { kind: "text", text: "unscripted" });

    this.#open.add(res);
    res.on("close", () => this.#open.delete(res));
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    if (reply.kind === "toolCall") {
      send(res, chunk(model, { role: "assistant", content: "" }));
      send(
        res,
        chunk(model, {
          tool_calls: [
            {
              index: 0,
              id: "call_scripted_1",
              type: "function",
              function: { name: reply.name, arguments: JSON.stringify(reply.arguments) },
            },
          ],
        })
      );
      send(res, chunk(model, {}, "tool_calls"));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    for (const word of splitForStreaming(reply.text)) {
      send(res, chunk(model, { role: "assistant", content: word }));
    }
    if (reply.kind === "hold") return; // held open until the client aborts
    send(res, chunk(model, {}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

/** Stream word-by-word so ordering of assistant chunks is observable. */
function splitForStreaming(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

function chunk(
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null
): Record<string, unknown> {
  return {
    id: "chatcmpl-scripted",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function send(res: http.ServerResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const part of req) parts.push(part as Uint8Array);
  return new TextDecoder().decode(concat(parts));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
