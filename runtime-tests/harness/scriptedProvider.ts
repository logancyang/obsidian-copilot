import * as http from "node:http";
import type { AddressInfo } from "node:net";

/** The path prefix of the base URL Copilot stores, and so of every request it configures. */
const BASE_PATH = "/v1";

/** One chat-completion request as the agent sent it, and how it was answered. */
export interface RecordedRequest {
  /** `turn` for an agent turn, `title` for opencode's session-title call. */
  kind: "turn" | "title";
}

export interface ScriptedProviderOptions {
  /** The only bearer credential the provider accepts. */
  apiKey: string;
  /** The text Copilot was asked to send, which an agent turn's last user message must equal. */
  sentText: () => string | undefined;
  /**
   * Awaited after each streamed chunk of an agent turn, before the next one is
   * written, with the answer text sent so far. Lets the caller hold every
   * chunk until the previous one is visible, so streaming order is observable
   * without timing assumptions. A rejection aborts the stream and is reported
   * as a failure.
   */
  pace: (sentSoFar: string) => Promise<void>;
}

/**
 * A localhost OpenAI-compatible endpoint that answers from a script.
 *
 * It replaces remote inference and nothing else: the agent reaches it through
 * its own `@ai-sdk/openai-compatible` adapter over real HTTP, configured by
 * production `buildOpencodeConfig`. Anything the script does not cover — a
 * path other than the configured one, a missing credential, another model, a
 * turn whose last user message is not what Copilot sent, a turn with no
 * scripted answer — is refused and recorded in {@link failures}.
 */
export class ScriptedProvider {
  readonly #options: ScriptedProviderOptions;
  #server: http.Server | null = null;
  #port = 0;
  #model = "";
  readonly #answers: string[] = [];
  readonly #requests: RecordedRequest[] = [];
  readonly #failures: string[] = [];
  readonly #open = new Set<http.ServerResponse>();

  constructor(options: ScriptedProviderOptions) {
    this.#options = options;
  }

  /** Base URL to store on the Copilot provider row (`.../v1`). */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}${BASE_PATH}`;
  }

  /** Chat-completion requests answered so far, oldest first. */
  get requests(): readonly RecordedRequest[] {
    return this.#requests;
  }

  /** Requests the script refused or could not complete, oldest first. */
  get failures(): readonly string[] {
    return this.#failures;
  }

  /** Queue an answer for the next agent turn, streamed one word at a time. */
  answer(text: string): void {
    this.#answers.push(text);
  }

  /** Listen on a loopback port, serving only `model`. */
  async start(model: string): Promise<void> {
    this.#model = model;
    const server = http.createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        this.#failures.push(`provider error on ${req.method} ${req.url}: ${String(error)}`);
        res.destroy();
      });
    });
    this.#server = server;
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
    const route = `${req.method} ${req.url}`;
    if (req.method !== "POST" || req.url !== `${BASE_PATH}/chat/completions`) {
      return this.#refuse(res, 404, `unexpected request ${route}`);
    }
    if (req.headers.authorization !== `Bearer ${this.#options.apiKey}`) {
      return this.#refuse(res, 401, `${route} did not carry the configured credential`);
    }

    const body = JSON.parse(await readBody(req)) as ChatCompletionRequest;
    const model = String(body.model);
    if (model !== this.#model) {
      return this.#refuse(res, 400, `${route} asked for model "${model}", not "${this.#model}"`);
    }
    // opencode names a new session with a separate, tool-less completion. It is
    // part of every first turn, so it gets a fixed title instead of consuming
    // the answer scripted for the turn.
    const kind = Array.isArray(body.tools) ? "turn" : "title";
    if (kind === "turn") {
      const received = body.messages?.findLast((message) => message.role === "user")?.content;
      const sent = this.#options.sentText();
      if (received !== sent) {
        return this.#refuse(
          res,
          400,
          `the agent turn's last user message was ${JSON.stringify(received)}, not ${JSON.stringify(sent)}`
        );
      }
    }
    const answer = kind === "title" ? "Runtime scenario" : this.#answers.shift();
    if (answer === undefined) {
      return this.#refuse(res, 500, `agent turn on "${model}" arrived with no scripted answer`);
    }
    this.#requests.push({ kind });

    this.#open.add(res);
    res.on("close", () => this.#open.delete(res));
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    let sent = "";
    for (const word of answer.match(/\s*\S+/g) ?? []) {
      sent += word;
      writeEvent(res, chunk(model, { role: "assistant", content: word }));
      if (kind === "title") continue;
      try {
        await this.#options.pace(sent);
      } catch (error) {
        this.#failures.push(`streaming "${answer}" stalled: ${String(error)}`);
        res.destroy();
        return;
      }
    }
    writeEvent(res, chunk(model, {}, "stop"));
    res.end("data: [DONE]\n\n");
  }

  #refuse(res: http.ServerResponse, status: number, reason: string): void {
    this.#failures.push(reason);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `[runtime-tests] ${reason}` } }));
  }
}

/** The parts of an OpenAI-compatible chat-completion request the script reads. */
interface ChatCompletionRequest {
  model?: unknown;
  tools?: unknown;
  messages?: { role: string; content: unknown }[];
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

function writeEvent(res: http.ServerResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = "";
  req.setEncoding("utf-8");
  for await (const part of req) body += part as string;
  return body;
}
