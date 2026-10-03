import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AgentCatalog, catalogOptions } from "./catalog";
export interface CompanionWireParams {
  sessionId: string;
  configId?: string;
  value?: string;
  modeId?: string;
  prompt?: ContentBlock[];
  plan?: string;
  planContent?: string;
  update?: {
    sessionUpdate: string;
    model_id?: string;
    reasoning_effort?: string;
    content?: ContentBlock;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export interface CompanionWireResult {
  sessionId?: string;
  models?: AgentCatalog;
  configOptions?: ReturnType<typeof catalogOptions>;
  modes?: { currentModeId: string; availableModes: Array<{ id: string; name: string }> };
  agentCapabilities?: { sessionCapabilities?: Record<string, object>; [key: string]: unknown };
  _meta?: { models?: AgentCatalog; model?: { Err?: string; Ok?: string }; [key: string]: unknown };
  [key: string]: unknown;
}
export interface CompanionWireFrame {
  id?: string | number;
  method?: string;
  params?: CompanionWireParams;
  result?: CompanionWireResult;
  error?: { code: number; message: string };
}
