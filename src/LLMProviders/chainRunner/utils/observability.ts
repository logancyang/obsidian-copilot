import { logInfo } from "@/logger";

type ToolSpanEvent =
  | {
      event: "tool.start";
      index: number;
      name: string;
      background?: boolean;
      concurrency?: number;
    }
  | {
      event: "tool.settle";
      index: number;
      name: string;
      status: string;
      durationMs?: number;
      background?: boolean;
      error?: string;
    };

export function emitToolSpan(span: ToolSpanEvent): void {
  logInfo(`[span] ${span.event}`, span);
}
