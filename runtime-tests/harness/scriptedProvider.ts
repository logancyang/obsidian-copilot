import * as http from "node:http";
import type { AddressInfo } from "node:net";

/** One provider row Copilot is configured with: the endpoint it names and the models it serves there. */
export interface ScriptedEndpoint {
  /** The first path segment of the endpoint's base URL (`/<name>/v1`). */
  name: string;
  models: readonly string[];
}

/** How the provider answers one agent turn. */
type ScriptedReply =
  /** Stream `text` one word at a time, then finish. */
  | { kind: "answer"; text: string }
  /** Ask the agent to run one of its own tools, as a model's tool call does. */
  | { kind: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  /** Stream `text`, then keep the response open and hand it to `onHeld`. */
  | { kind: "hold"; text: string; onHeld: (held: HeldStream) => void }
  /**
   * Refuse with an HTTP error, as an OpenAI-compatible endpoint does, then call
   * `onRefused`. `retryAfterMs` sets the `retry-after-ms` header.
   */
  | {
      kind: "error";
      status: number;
      message: string;
      retryAfterMs: number | undefined;
      onRefused: () => void;
    };

/** One chat-completion request as the agent sent it. */
export interface RecordedRequest {
  /** `turn` for an agent turn, `title` for opencode's session-title call. */
  kind: "turn" | "title";
  /** The endpoint the request arrived at. */
  endpoint: string;
  model: string;
  /** The request's `reasoning_effort` field, or `null` when it carried none. */
  reasoningEffort: string | null;
  /** The request's last user message: the question an agent turn answers. */
  question: string;
  /** The conversation the request carried, without the system prompt. */
  messages: readonly RecordedMessage[];
}

/** One message of a recorded request's conversation. */
export interface RecordedMessage {
  role: string;
  content: string;
  /** On a `tool` message, the id of the tool call it answers. */
  toolCallId?: string;
}

/** A conversation waiting on an answer, as the provider paces its stream. */
export interface Asker {
  /** Resolves once the answer shown reads exactly `text`; rejects if it never does. */
  waitForAnswerText(text: string): Promise<void>;
}

/**
 * An answer the provider stopped streaming partway. It stays open until the
 * scenario releases or breaks it, or the agent closes the request.
 */
export interface HeldStream {
  /** The user message the held answer responds to. */
  readonly question: string;
  readonly state: "held" | "released" | "broken" | "closed by the agent";
  /** Stream `rest` and finish the answer. */
  release(rest: string): void;
  /** Destroy the connection mid-answer, as a dropped provider stream does. */
  break(): void;
  /** Resolves when the agent closes the request itself, as a cancelled turn does. */
  readonly closedByAgent: Promise<void>;
}

export interface ScriptedProviderOptions {
  /** The only bearer credential the provider accepts. */
  apiKey: string;
  /**
   * The conversation waiting on an answer to `message`, an agent turn's last
   * user message, or `undefined` when no conversation sent it. Each streamed
   * chunk waits until that conversation shows it before the next is written,
   * so streaming order is observable without timing assumptions.
   */
  askerFor: (message: string) => Asker | undefined;
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
 * whose last user message no conversation sent, a turn with no scripted
 * reply — is refused and recorded in {@link failures}.
 */
export class ScriptedProvider {
  readonly #options: ScriptedProviderOptions;
  #server: http.Server | null = null;
  #port = 0;
  #endpoints: readonly ScriptedEndpoint[] = [];
  readonly #replies: ScriptedReply[] = [];
  readonly #requests: RecordedRequest[] = [];
  readonly #failures: string[] = [];
  readonly #open = new Set<http.ServerResponse>();
  readonly #held: HeldStream[] = [];
  #toolCalls = 0;
  /** The last error reply and the question it refused, which it keeps refusing. */
  #failing: { question: string; reply: ScriptedReply } | null = null;

  constructor(options: ScriptedProviderOptions) {
    this.#options = options;
  }

  /** Base URL to store on the Copilot provider row for `endpoint` (`.../<endpoint>/v1`). */
  baseUrl(endpoint: string): string {
    return `http://127.0.0.1:${this.#port}/${endpoint}/v1`;
  }

  /** Chat-completion requests received so far, oldest first. */
  get requests(): readonly RecordedRequest[] {
    return this.#requests;
  }

  /** Requests the script refused or could not complete, oldest first. */
  get failures(): readonly string[] {
    return this.#failures;
  }

  /** Answers held so far, oldest first, including ones since released, broken, or closed. */
  get held(): readonly HeldStream[] {
    return this.#held;
  }

  /**
   * Queue a tool call for the next agent turn: `name` with `args`, as a model
   * asks for one. The agent runs its real tool and sends the result in its next
   * request. Returns the call's id, which that result carries.
   */
  callTool(name: string, args: Record<string, unknown>): string {
    const id = `call_scripted_${++this.#toolCalls}`;
    this.#replies.push({ kind: "toolCall", id, name, arguments: args });
    return id;
  }

  /** Queue an answer for the next agent turn, streamed one word at a time. */
  answer(text: string): void {
    this.#replies.push({ kind: "answer", text });
  }

  /**
   * Queue an answer for the next agent turn that streams `text` and then stays
   * open. Resolves with the open answer once the conversation shows `text`.
   */
  hold(text: string): Promise<HeldStream> {
    return new Promise((onHeld) => this.#replies.push({ kind: "hold", text, onHeld }));
  }

  /**
   * Queue an HTTP error for the next agent turn. It refuses every later
   * attempt at the same question too, as a provider that keeps failing does.
   * Resolves once the first refusal has been sent.
   *
   * @param retryAfterMs The `retry-after-ms` header, which sets opencode's wait
   * before its next attempt; without it opencode backs off on its own.
   */
  refuse(status: number, message: string, retryAfterMs?: number): Promise<void> {
    return new Promise((onRefused) =>
      this.#replies.push({ kind: "error", status, message, retryAfterMs, onRefused })
    );
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
    // the reply scripted for the turn.
    const kind = Array.isArray(body.tools) ? "turn" : "title";
    const messages = (body.messages ?? [])
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
      }));
    const question = messages.findLast((message) => message.role === "user")?.content ?? "";
    let asker: Asker | undefined;
    if (kind === "turn") {
      asker = this.#options.askerFor(question);
      if (!asker) {
        return this.#refuse(
          res,
          400,
          `the agent turn's last user message was ${JSON.stringify(question)}, which no conversation sent`
        );
      }
    }
    const reply =
      kind === "title"
        ? TITLE_REPLY
        : this.#failing?.question === question
          ? this.#failing.reply
          : this.#replies.shift();
    if (reply === undefined) {
      return this.#refuse(res, 400, `agent turn on "${model}" arrived with no scripted reply`);
    }
    this.#requests.push({
      kind,
      endpoint: endpoint.name,
      model,
      reasoningEffort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
      question,
      messages,
    });

    if (reply.kind === "error") {
      this.#failing = { question, reply };
      const retryAfter =
        reply.retryAfterMs === undefined ? {} : { "retry-after-ms": String(reply.retryAfterMs) };
      res.writeHead(reply.status, { "content-type": "application/json", ...retryAfter });
      res.end(JSON.stringify({ error: { message: reply.message } }), reply.onRefused);
      return;
    }

    if (reply.kind === "toolCall") {
      const call = { name: reply.name, arguments: JSON.stringify(reply.arguments) };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      writeEvent(
        res,
        chunk(model, {
          role: "assistant",
          tool_calls: [{ index: 0, id: reply.id, type: "function", function: call }],
        })
      );
      writeEvent(res, chunk(model, {}, "tool_calls"));
      res.end("data: [DONE]\n\n");
      return;
    }

    this.#open.add(res);
    let closedByProvider = false;
    const closedByAgent = new Promise<void>((resolve) =>
      res.on("close", () => {
        this.#open.delete(res);
        if (!closedByProvider) resolve();
      })
    );
    const close = (): void => {
      closedByProvider = true;
      res.destroy();
    };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    // Writes each word once the asker shows everything before it. Returns false
    // when the stream ended early: the answer stalled, or the agent closed it.
    let sent = "";
    const stream = async (text: string): Promise<boolean> => {
      for (const word of text.match(/\s*\S+/g) ?? []) {
        sent += word;
        writeEvent(res, chunk(model, { role: "assistant", content: word }));
        if (!asker) continue;
        try {
          await Promise.race([asker.waitForAnswerText(sent), closedByAgent]);
        } catch (error) {
          this.#failures.push(`streaming "${sent}" stalled: ${String(error)}`);
          close();
          return false;
        }
        if (res.destroyed) return false;
      }
      return true;
    };

    if (!(await stream(reply.text))) return;
    if (reply.kind === "hold") {
      const rest = await this.#hold(question, closedByAgent, reply.onHeld);
      if (rest === null) return close();
      if (!(await stream(rest))) return;
    }
    writeEvent(res, chunk(model, {}, "stop"));
    closedByProvider = true;
    res.end("data: [DONE]\n\n");
  }

  /**
   * Hand a {@link HeldStream} to `onHeld` and wait for the scenario or the
   * agent to end the hold. Resolves with the rest of the answer on release, or
   * `null` once the stream is broken or closed.
   */
  #hold(
    question: string,
    closedByAgent: Promise<void>,
    onHeld: (held: HeldStream) => void
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const held = {
        question,
        state: "held" as HeldStream["state"],
        closedByAgent,
        release: (rest: string) => {
          if (held.state !== "held") return;
          held.state = "released";
          resolve(rest);
        },
        break: () => {
          if (held.state !== "held") return;
          held.state = "broken";
          resolve(null);
        },
      };
      void closedByAgent.then(() => {
        if (held.state !== "held") return;
        held.state = "closed by the agent";
        resolve(null);
      });
      this.#held.push(held);
      onHeld(held);
    });
  }

  #refuse(res: http.ServerResponse, status: number, reason: string): void {
    this.#failures.push(reason);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `[runtime-tests] ${reason}` } }));
  }
}

/** The fixed answer to opencode's session-title call. */
const TITLE_REPLY: ScriptedReply = { kind: "answer", text: "Runtime scenario" };

/** The parts of an OpenAI-compatible chat-completion request the script reads. */
interface ChatCompletionRequest {
  model?: unknown;
  reasoning_effort?: unknown;
  tools?: unknown;
  messages?: { role: string; content: unknown; tool_call_id?: string }[];
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
