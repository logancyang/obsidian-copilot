import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";

export interface ClientTransport {
  send(frame: ClientFrame): void;
  onFrame(cb: (frame: ServerFrame) => void): () => void;
  onOpenChange(cb: (open: boolean) => void): () => void;
  close(): void;
}
