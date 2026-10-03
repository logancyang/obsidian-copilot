import { createInterface } from "node:readline";
import type { ContentBlock, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { MuseSession, MuseRequestError, REASONING_EFFORTS, type MuseClient } from "./session.mjs";
import { normalizeCatalogResponse, catalogOptions } from "../catalog";

interface Frame {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}
const send = (frame: unknown) => {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...(frame as object) }) + "\n");
};
const log = (message: string) => {
  process.stderr.write(message + "\n");
};
const sessions = new Map<string, MuseSession>();
const permissions = new Map<
  string,
  { resolve: (value: RequestPermissionResponse) => void; reject: (error: Error) => void }
>();
let nextId = 0;
let shutdown: Promise<void> | undefined;
const client: MuseClient = {
  async notify(method, params) {
    send({ method, params });
  },
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = `muse-permission:${++nextId}`;
      permissions.set(id, { resolve, reject });
      send({ id, method, params });
    });
  },
};
const makeSession = () =>
  new MuseSession(client, log, (error) => {
    void stop(error);
  });
const root = makeSession();
const stop = (error?: unknown): Promise<void> => {
  if (error) {
    log(error instanceof Error ? error.message : JSON.stringify(error));
    process.exitCode = 1;
  }
  return (shutdown ??= Promise.resolve().then(async () => {
    for (const permission of permissions.values())
      permission.reject(new Error("Muse adapter closed"));
    permissions.clear();
    await Promise.allSettled([root, ...sessions.values()].map((session) => session.close()));
    process.stdin.destroy();
  }));
};
const text = (p: Record<string, unknown>, key: string): string => {
  if (typeof p[key] !== "string") throw new Error(`Missing ${key}`);
  return p[key];
};
const servers = (p: Record<string, unknown>): unknown[] => {
  if (!Array.isArray(p.mcpServers)) throw new Error("Missing mcpServers");
  return p.mcpServers;
};
const resolveSession = (p: Record<string, unknown>) => {
  const session = sessions.get(text(p, "sessionId"));
  if (!session) throw new Error("Unknown Muse session");
  return session;
};

async function request(method: string, p: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize": {
      await root.initialize();
      const models = await root.models();
      return {
        protocolVersion: 1,
        agentInfo: { name: "copilot_muse_adapter", version: "1" },
        _meta: { models },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, close: {} },
          promptCapabilities: { image: false, embeddedContext: false },
        },
      };
    }
    case "session/new": {
      const session = makeSession();
      try {
        await session.initialize();
        const result = await session.newSession(text(p, "cwd"), servers(p));
        sessions.set(result.sessionId, session);
        return normalizeCatalogResponse(result, REASONING_EFFORTS);
      } catch (error) {
        await session.close();
        throw error;
      }
    }
    case "session/load": {
      const id = text(p, "sessionId");
      const existing = sessions.get(id);
      if (existing) {
        await existing.close();
        sessions.delete(id);
      }
      const session = makeSession();
      try {
        await session.initialize();
        const result = await session.loadSession(id, text(p, "cwd"), servers(p));
        sessions.set(id, session);
        return normalizeCatalogResponse(result, REASONING_EFFORTS);
      } catch (error) {
        await session.close();
        throw error;
      }
    }
    case "session/list":
      return root.listSessions(
        typeof p.cwd === "string" ? p.cwd : undefined,
        typeof p.cursor === "string" ? p.cursor : undefined
      );
    case "session/close": {
      await resolveSession(p).close();
      sessions.delete(text(p, "sessionId"));
      return {};
    }
    case "session/set_mode":
      return resolveSession(p).setMode(text(p, "sessionId"), text(p, "modeId"));
    case "session/set_config_option": {
      const session = resolveSession(p),
        id = text(p, "sessionId"),
        value = text(p, "value"),
        configId = text(p, "configId");
      if (configId === "model") {
        const catalog = await session.models();
        if (!catalog.availableModels.some((model) => model.modelId === value))
          throw new Error("Unsupported Muse model");
        await session.setModel(id, value);
      } else if (configId === "reasoning_effort") {
        const effort = REASONING_EFFORTS.find((level) => level === value);
        if (!effort) throw new Error("Unsupported Muse reasoning effort");
        await session.setReasoningEffort(id, effort);
      } else throw new Error("Unsupported Muse configuration");
      const models = await session.models();
      const configOptions = catalogOptions(
        models,
        models.availableModels.find((model) => model.modelId === models.currentModelId)?._meta
          .reasoningEffort,
        REASONING_EFFORTS
      );
      await client.notify("session/update", {
        sessionId: id,
        update: { sessionUpdate: "config_option_update", configOptions },
      });
      return { configOptions };
    }
    case "session/prompt": {
      if (
        !Array.isArray(p.prompt) ||
        p.prompt.some(
          (part: unknown) =>
            !part ||
            typeof part !== "object" ||
            !("type" in part) ||
            part.type !== "text" ||
            !("text" in part) ||
            typeof part.text !== "string"
        )
      )
        throw new Error("Muse adapter accepts text prompts only");
      return resolveSession(p).prompt(text(p, "sessionId"), p.prompt as ContentBlock[]);
    }
    case "session/cancel":
      await resolveSession(p).cancel(text(p, "sessionId"));
      return {};
    default:
      throw new MuseRequestError(-32601, `Unsupported Muse method: ${method}`);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  void (async () => {
    let frame: Frame | undefined;
    try {
      frame = JSON.parse(line) as Frame;
      if (!frame.method) {
        const pending = permissions.get(String(frame.id));
        if (pending) {
          permissions.delete(String(frame.id));
          if (frame.error) pending.reject(new Error(frame.error.message));
          else pending.resolve(frame.result as RequestPermissionResponse);
        }
        return;
      }
      const result = await request(frame.method, frame.params ?? {});
      if (frame.id !== undefined) send({ id: frame.id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      if (frame?.id !== undefined)
        send({
          id: frame.id,
          error: { code: error instanceof MuseRequestError ? error.code : -32603, message },
        });
      else log(message);
    }
  })();
});
process.stdin.on("end", () => {
  void stop();
});
process.stdin.on("error", (error) => {
  void stop(error);
});
process.stdout.on("error", (error) => {
  void stop(error);
});
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
