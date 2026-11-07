import type { CustomServerProcess } from "@/connectors/custom/customConnectors";
import type { StdioServerOptions } from "@/connectors/custom/stdioServer";

export class FakeProcess implements CustomServerProcess {
  stopped = false;

  constructor(
    readonly options: StdioServerOptions,
    readonly crash: (reason: string) => void
  ) {}

  async start(): Promise<void> {
    const key = this.options.env.FAKE_KEY;
    if (!key) throw new Error("FAKE_KEY is not set");
    if (key.startsWith("wrong")) throw new Error(`Invalid key ${key}`);
  }

  async request(method: string, params: Record<string, unknown>) {
    if (method === "tools/list") {
      return {
        tools: [
          { name: "echo", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
          { name: "remember", inputSchema: { type: "object" } },
        ],
      };
    }
    const args = params.arguments as { text: string };
    return { content: [{ type: "text", text: `${this.options.env.FAKE_KEY}: ${args.text}` }] };
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
