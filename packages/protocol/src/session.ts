export type SessionId = string;

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";
