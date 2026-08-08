/**
 * Wire-shape types for the `models.dev/api.json` response.
 *
 * Kept permissive: every field except the per-provider/per-model `id`
 * is optional, so a small upstream schema addition doesn't break us.
 * Runtime validation lives in `catalogTransform` — it filters bad
 * entries individually instead of rejecting the whole payload.
 */

export interface WireModel {
  id: string;
  name?: string;
  family?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  attachment?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
  limit?: { context?: number; output?: number; input?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

export interface WireProvider {
  id: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models?: Record<string, WireModel>;
}

export type WireCatalog = Record<string, WireProvider>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
