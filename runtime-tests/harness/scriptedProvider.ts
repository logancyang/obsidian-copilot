import * as http from "node:http";
import type { AddressInfo } from "node:net";

/** One provider row Copilot is configured with: the endpoint it names and the models it serves there. */
export interface ScriptedEndpoint {
  /** The first path segment of the endpoint's base URL (`/<name>/v1`). */
  name: string;
  models: readonly string[];
}

/** One chat-completion request as the agent sent it, and how it was answered. */
export interface RecordedRequest {
  /** `turn` for an agent turn, `title` for opencode's session-title call. */
  kind: "turn" | "title";
  /** The endpoint the request arrived at. */
  endpoint: string;
  model: string;
  /** The request's `reasoning_effort` field, or `null` when it carried none. */
  reasoningEffort: string | null;
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
 * Localhost OpenAI-compatible endpoints that answer from a script.
 *
 * They replace remote inference and nothing else: the agent reaches them
 * through its own `@ai-sdk/openai-compatible` adapter over real HTTP,
 * configured by production `buildOpencodeConfig`. One server hosts every
 * endpoint, each under its own base path, so which endpoint a request reached
 * is observable. Anything the script does not cover — a path no endpoint
 * serves, a missing credential, a model the endpoint does not serve, a turn
 * whose last user message is not what Copilot sent, a turn with no scripted
 * answer — is refused and recorded in {@link failures}.
 */
export class ScriptedProvider {
  readonly #options: ScriptedProviderOptions;
  #server: http.Server | null = null;
  #port = 0;
  #endpoints: readonly ScriptedEndpoint[] = [];
  readonly #answers: string[] = [];
  readonly #requests: RecordedRequest[] = [];
  readonly #failures: string[] = [];
  readonly #open = new Set<http.ServerResponse>();

  constructor(options: ScriptedProviderOptions) {
    this.#options = options;
  }

  /** Base URL to store on the Copilot provider row for `endpoint` (`.../<endpoint>/v1`). */
  baseUrl(endpoint: string): string {
    return `http://127.0.0.1:${this.#port}/${endpoint}/v1`;
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

  /** Listen on a loopback port, serving only `endpoints`. */
  async start(endpoints: readonly ScriptedEndpoint[]): Promise<void> {
    this.#endpoints = endpoints;
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
    const endpoint = this.#endpoints.find(
      (candidate) => req.url === `/${candidate.name}/v1/chat/completions`
    );
    if (req.method !== "POST" || !endpoint) {
      return this.#refuse(res, 404, `unexpected request ${route}`);
    }
    if (req.headers.authorization !== `Bearer ${this.#options.apiKey}`) {
      return this.#refuse(res, 401, `${route} did not carry the configured credential`);
    }

    const body = JSON.parse(await readBody(req)) as ChatCompletionRequest;
    const model = String(body.model);
    if (!endpoint.models.includes(model)) {
      return this.#refuse(
        res,
        400,
        `${route} asked for model "${model}", which the "${endpoint.name}" endpoint does not serve`
      );
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
    this.#requests.push({
      kind,
      endpoint: endpoint.name,
      model,
      reasoningEffort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
    });

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
  reasoning_effort?: unknown;
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
