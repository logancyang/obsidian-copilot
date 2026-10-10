import type { ModelEnableGroup, ModelEnableRow } from "@/components/ui/ModelEnableList";
import { isOpencodeZenWireId, OPENCODE_ZEN_PROVIDER_ID } from "@/utils/opencodeModelId";
import {
  COPILOT_PLUS_DESTINATION,
  providerDestination,
  capabilitiesFromConfiguredInfo,
  type ConfiguredModel,
  type PersistedCopilotPlusCatalog,
  type Provider,
} from "@/modelManagement";

const EMPTY_PLUS_CATALOG: PersistedCopilotPlusCatalog = Object.freeze({
  models: Object.freeze([]),
  defaultEnabledIds: Object.freeze([]),
}) as unknown as PersistedCopilotPlusCatalog;

export interface Candidate {
  configuredModel: ConfiguredModel;
  provider: Provider;
  enabled: boolean;
}

export interface CandidatePartition {
  byokPlusCandidates: Candidate[];
  agentOriginCandidates: Candidate[];
}

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
      if (origin.agentType === agentType) agentOriginCandidates.push(candidate);
      continue;
    }
    if (isOpencode && (origin.kind === "byok" || origin.kind === "copilot-plus")) {
      if (isOpencodeRoutable && !isOpencodeRoutable(provider)) continue;
      byokPlusCandidates.push(candidate);
    }
  }
  return { byokPlusCandidates, agentOriginCandidates };
}

export function partitionChatCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>
): CandidatePartition {
  const byokPlusCandidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    if (configuredModel.info.isEmbedding) continue;
    const provider = providers[configuredModel.providerId];
    if (!provider) continue;
    if (provider.origin.kind === "agent") continue;
    byokPlusCandidates.push({
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    });
  }
  return { byokPlusCandidates, agentOriginCandidates: [] };
}

export function opencodeOnlySubGroupLabel(model: ConfiguredModel, provider: Provider): string {
  const slash = model.info.id.indexOf("/");
  if (slash > 0) return model.info.id.slice(0, slash);
  return provider.displayName;
}

export function toRow(candidate: Candidate): ModelEnableRow {
  const { configuredModel, enabled } = candidate;
  const { displayName, id, description } = configuredModel.info;
  return {
    id: configuredModel.configuredModelId,
    label: displayName || id,
    description: description || undefined,
    wireId: id,
    enabled,
    isFree: isOpencodeZenWireId(id),
    capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
  };
}

export function rowMatches(row: ModelEnableRow, q: string): boolean {
  if (!q) return true;
  return (
    row.label.toLowerCase().includes(q) ||
    row.id.toLowerCase().includes(q) ||
    (row.wireId?.toLowerCase().includes(q) ?? false) ||
    (row.description?.toLowerCase().includes(q) ?? false)
  );
}

type OriginKind = Provider["origin"]["kind"];

function originBadgeLabel(kind: OriginKind): string {
  switch (kind) {
    case "byok":
      return "BYOK";
    case "copilot-plus":
      return "Copilot";
    case "agent":
      return "Agent Provided";
  }
}

interface OriginGroup {
  group: ModelEnableGroup;
  kind: OriginKind;
}

export function buildModelEnableGroups(
  partition: CandidatePartition,
  isOpencode: boolean,
  query: string,
  copilotProviderMissing: boolean,
  copilotPlusCatalog: PersistedCopilotPlusCatalog = EMPTY_PLUS_CATALOG
): ModelEnableGroup[] {
  const q = query.trim().toLowerCase();
  const out: OriginGroup[] = [];

  const byProvider = new Map<
    string,
    { provider: Provider; kind: OriginKind; rows: ModelEnableRow[] }
  >();
  for (const candidate of partition.byokPlusCandidates) {
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const key = candidate.provider.providerId;
    const bucket = byProvider.get(key);
    if (bucket) bucket.rows.push(row);
    else
      byProvider.set(key, {
        provider: candidate.provider,
        kind: candidate.provider.origin.kind,
        rows: [row],
      });
  }
  for (const [key, { provider, kind, rows }] of byProvider) {
    const label = provider.displayName;
    const destination = providerDestination(provider);
    out.push({ group: { key: `byok:${key}`, label, destination, rows }, kind });
  }

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
    // opencode's own providers have no Copilot settings row, so their group names the destination.
    // https://github.com/logancyang/obsidian-copilot/issues/2889
    const destination = isOpencode
      ? {
          kind: "cloud" as const,
          label: label === OPENCODE_ZEN_PROVIDER_ID ? "OpenCode Zen" : label,
        }
      : undefined;
    out.push({ group: { key: `agent:${label}`, label, destination, rows }, kind: "agent" });
  }

  if (isOpencode && copilotProviderMissing) {
    const rows = copilotPlusCatalog.models
      .map(
        (model): ModelEnableRow => ({
          id: `__locked_copilot__${model.id}`,
          label: model.displayName || model.id,
          description: model.description,
          wireId: model.id,
          enabled: false,
          locked: true,
        })
      )
      .filter((row) => rowMatches(row, q));
    if (rows.length > 0) {
      out.push({
        group: {
          key: "locked:copilot-plus",
          label: "Copilot",
          destinationNote: "Copilot license required",
          rows,
        },
        kind: "copilot-plus",
      });
    }
  }

  const mixed = new Set(out.map((o) => o.kind)).size > 1;
  for (const o of out) {
    if (o.kind === "copilot-plus") {
      o.group.highlight = true;
      o.group.badge = "privacy";
      o.group.destination = COPILOT_PLUS_DESTINATION;
    } else if (mixed) {
      o.group.badge = originBadgeLabel(o.kind);
    }
  }
  out.sort((a, b) => Number(b.kind === "copilot-plus") - Number(a.kind === "copilot-plus"));
  return out.map((o) => o.group);
}
