/** Pure grouping logic for `ConfiguredModelEnableList`, split from the React container so it's testable with plain data. */

import type { ModelEnableGroup, ModelEnableRow } from "@/agentMode";
import type { ConfiguredModel, Provider } from "@/modelManagement";

/** One candidate model joined to its provider, plus current enabled state. */
export interface Candidate {
  configuredModel: ConfiguredModel;
  provider: Provider;
  enabled: boolean;
}

/** The two candidate buckets a backend's configured models partition into. */
export interface CandidatePartition {
  /** BYOK/Plus configured models (opencode candidates only). */
  byokPlusCandidates: Candidate[];
  /** This agent's own agent-origin models. */
  agentOriginCandidates: Candidate[];
}

/**
 * Split configured models into this backend's candidate buckets: agent-origin
 * models matching `agentType`, plus BYOK/Plus models for opencode only.
 *
 * For opencode, a BYOK/Plus provider it can't route (`isOpencodeRoutable`
 * false — azure / bedrock / self-hosted) is dropped to avoid a dead toggle:
 * `opencodeEnabledModelEntries` skips unroutable providers, so enabling one
 * would never reach the agent or picker.
 */
export function partitionCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>,
  agentType: string,
  isOpencode: boolean,
  isOpencodeRoutable?: (provider: Provider) => boolean
): CandidatePartition {
  const byokPlusCandidates: Candidate[] = [];
  const agentOriginCandidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    const provider = providers[configuredModel.providerId];
    if (!provider) continue;
    const candidate: Candidate = {
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    };
    const origin = provider.origin;
    if (origin.kind === "agent") {
      // Agent-origin models are exclusive to their agent's picker.
      if (origin.agentType === agentType) agentOriginCandidates.push(candidate);
      continue;
    }
    // BYOK / Plus rows are candidates for opencode only — and only when
    // opencode can actually route the provider (no dead toggles).
    if (isOpencode && (origin.kind === "byok" || origin.kind === "copilot-plus")) {
      if (isOpencodeRoutable && !isOpencodeRoutable(provider)) continue;
      byokPlusCandidates.push(candidate);
    }
  }
  return { byokPlusCandidates, agentOriginCandidates };
}

/**
 * The opencode-only sub-group label: the wire-id prefix (e.g.
 * `opencode/big-pickle` → `opencode`). All opencode-only models live under one
 * agent provider with full-prefixed ids, so sub-grouping comes from the prefix,
 * not separate Provider rows. Falls back to the provider name when unprefixed.
 */
export function opencodeOnlySubGroupLabel(model: ConfiguredModel, provider: Provider): string {
  const slash = model.info.id.indexOf("/");
  if (slash > 0) return model.info.id.slice(0, slash);
  return provider.displayName;
}

/**
 * A `ModelEnableRow` from a candidate. The secondary line is the model's
 * capability blurb (`info.description`), which only the curated agent backends
 * persist (claude, codex); BYOK/Plus and opencode carry none and so render a
 * single line. We deliberately don't fall back to the wire id for display — it
 * duplicates the label — but we still carry it in `wireId` so search keeps
 * matching it. This keeps the row identical to the chat picker.
 */
export function toRow(candidate: Candidate): ModelEnableRow {
  const { configuredModel, enabled } = candidate;
  const { displayName, id, description } = configuredModel.info;
  return {
    id: configuredModel.configuredModelId,
    label: displayName || id,
    description: description || undefined,
    wireId: id,
    enabled,
  };
}

/** Case-insensitive match of a row against a (lowercased) search query. */
export function rowMatches(row: ModelEnableRow, q: string): boolean {
  if (!q) return true;
  return (
    row.label.toLowerCase().includes(q) ||
    row.id.toLowerCase().includes(q) ||
    (row.wireId?.toLowerCase().includes(q) ?? false) ||
    (row.description?.toLowerCase().includes(q) ?? false)
  );
}

/** Provider-origin kind, used to label the per-group disambiguation badge. */
type OriginKind = Provider["origin"]["kind"];

/** User-facing badge label for a provider's origin. */
function originBadgeLabel(kind: OriginKind): string {
  switch (kind) {
    case "byok":
      return "BYOK";
    case "copilot-plus":
      return "Copilot Plus";
    case "agent":
      return "Agent Provided";
  }
}

/** A built group paired with the origin kind every row in it shares. */
interface OriginGroup {
  group: ModelEnableGroup;
  kind: OriginKind;
}

/**
 * Provider-grouped rows for the shared list. BYOK/Plus candidates get one group
 * per provider; agent-origin candidates get wire-prefix sub-groups for opencode
 * (`opencode`, `openrouter`, …) or a per-provider group for claude/codex. All
 * groups render the same flat way. Groups emptied by `query` are dropped.
 *
 * Each group maps to a single origin, so when the list spans more than one
 * origin (opencode mixes BYOK/Plus/agent) we tag every group with an origin
 * badge to disambiguate; a single-origin list (claude/codex) gets none.
 */
export function buildModelEnableGroups(
  partition: CandidatePartition,
  isOpencode: boolean,
  query: string
): ModelEnableGroup[] {
  const q = query.trim().toLowerCase();
  const out: OriginGroup[] = [];

  // BYOK/Plus providers — one group per provider.
  const byProvider = new Map<string, { label: string; kind: OriginKind; rows: ModelEnableRow[] }>();
  for (const candidate of partition.byokPlusCandidates) {
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const key = candidate.provider.providerId;
    const bucket = byProvider.get(key);
    if (bucket) bucket.rows.push(row);
    else
      byProvider.set(key, {
        label: candidate.provider.displayName,
        kind: candidate.provider.origin.kind,
        rows: [row],
      });
  }
  for (const [key, { label, kind, rows }] of byProvider) {
    out.push({ group: { key: `byok:${key}`, label, rows }, kind });
  }

  // Agent-origin models — opencode-only sub-groups (by wire prefix) or a
  // provider group for claude/codex.
  const bySubGroup = new Map<string, { label: string; rows: ModelEnableRow[] }>();
  for (const candidate of partition.agentOriginCandidates) {
    const label = isOpencode
      ? opencodeOnlySubGroupLabel(candidate.configuredModel, candidate.provider)
      : candidate.provider.displayName;
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const bucket = bySubGroup.get(label);
    if (bucket) bucket.rows.push(row);
    else bySubGroup.set(label, { label, rows: [row] });
  }
  for (const [label, { rows }] of bySubGroup) {
    out.push({ group: { key: `agent:${label}`, label, rows }, kind: "agent" });
  }

  // Copilot Plus is highlighted and floated to the top; its provider name
  // already reads "Copilot Plus", so it carries no disambiguating badge. Every
  // other origin gets a badge only when the list actually mixes origins.
  const mixed = new Set(out.map((o) => o.kind)).size > 1;
  for (const o of out) {
    if (o.kind === "copilot-plus") {
      o.group.highlight = true;
    } else if (mixed) {
      o.group.badge = originBadgeLabel(o.kind);
    }
  }
  // Stable sort (V8 sort is stable): Copilot Plus first, others keep their order.
  out.sort((a, b) => Number(b.kind === "copilot-plus") - Number(a.kind === "copilot-plus"));
  return out.map((o) => o.group);
}
