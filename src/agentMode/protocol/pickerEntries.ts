import type { BackendSummary, PickerModel } from "@/agentMode/protocol/state";
import type { BackendId, EffortOption, ModelEntry, ModelState } from "@/agentMode/session/types";

export const AGENT_PROVIDER = "agent";

export const MISSING_KEY_LABEL = "Add API key";

export const EMPTY_EFFORT_OPTIONS: readonly EffortOption[] = Object.freeze([]);

const LOADING_ID = "__preload_pending__";
const FAILED_ID = "__preload_error__";

/**
 * What the model picker needs to know about the client's own active session: which agent it runs,
 * whether it already holds a conversation, and the model state that agent reported.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export interface PickerActiveSession {
  backendId: BackendId;
  hasHistory: boolean;
  modelState: ModelState | null;
}

export interface PickerEntries {
  entries: PickerModel[];
  selected: PickerModel | null;
}

export function baseModelIdOf(entry: PickerModel): string | undefined {
  return entry.provider === AGENT_PROVIDER ? entry.name : undefined;
}

export function agentPickerModel(
  backend: Pick<BackendSummary, "id" | "displayName">,
  baseModelId: string,
  humanName: string,
  extras: Pick<PickerModel, "subtitle" | "isFree" | "capabilities"> = {}
): PickerModel {
  const model: PickerModel = {
    name: baseModelId,
    provider: AGENT_PROVIDER,
    displayName: humanName || baseModelId,
    group: backend.displayName,
    backendId: backend.id,
  };
  if (extras.capabilities !== undefined) model.capabilities = extras.capabilities;
  if (extras.subtitle !== undefined) model.subtitle = extras.subtitle;
  if (extras.isFree !== undefined) model.isFree = extras.isFree;
  return model;
}

function placeholder(backend: BackendSummary, pending: boolean): PickerModel {
  return {
    ...agentPickerModel(
      backend,
      pending ? LOADING_ID : FAILED_ID,
      pending ? "Loading models…" : "Failed to load"
    ),
    disabledReason: pending ? "Loading…" : "Unavailable",
  };
}

function readinessReason(readiness: BackendSummary["readiness"]): string | undefined {
  switch (readiness) {
    case "not_set_up":
      return "Not set up";
    case "update_required":
      return "Update required";
    case "setup_error":
      return "Setup error";
    case "checking":
    case "ready":
      return undefined;
  }
}

function appendSection(
  entries: PickerModel[],
  backend: BackendSummary,
  keepBaseModelId: string | null,
  useEnabledFallback: boolean
): void {
  const { enabled, reported } = backend;
  if (!enabled) return;
  if (!reported) {
    if (!useEnabledFallback) return;
    for (const model of enabledFallback(backend, enabled)) entries.push(model);
    return;
  }
  const reportedById = new Map(reported.map((model) => [model.baseModelId, model]));
  const emitted = new Set<string>();
  for (const model of enabled) {
    const seen = reportedById.get(model.baseModelId);
    const entry = agentPickerModel(
      backend,
      model.baseModelId,
      seen?.name || model.name || model.baseModelId,
      {
        subtitle: seen?.description ?? model.description,
        isFree: model.isFree,
        capabilities: model.capabilities,
      }
    );
    const reason = model.missingKey ? MISSING_KEY_LABEL : seen ? undefined : "Not offered by agent";
    if (reason) entry.disabledReason = reason;
    if (model.needsSelfHostWarning) entry.needsSelfHostWarning = true;
    entries.push(entry);
    emitted.add(model.baseModelId);
  }
  if (keepBaseModelId && !emitted.has(keepBaseModelId)) {
    const seen = reportedById.get(keepBaseModelId);
    if (seen) {
      entries.push(
        agentPickerModel(backend, seen.baseModelId, seen.name, { subtitle: seen.description })
      );
    }
  }
}

function enabledFallback(
  backend: BackendSummary,
  enabled: NonNullable<BackendSummary["enabled"]>
): PickerModel[] {
  return enabled.map((model) => {
    const entry = agentPickerModel(backend, model.baseModelId, model.name || model.baseModelId, {
      subtitle: model.description,
      isFree: model.isFree,
      capabilities: model.capabilities,
    });
    if (model.missingKey) entry.disabledReason = MISSING_KEY_LABEL;
    return entry;
  });
}

/**
 * Assembles the model picker from the host's catalog and the client's own active session.
 *
 * An agent other than the active one is offered only while the active session has no history
 * (a conversation cannot change agents), its rows are disabled with the reason its readiness
 * gives, and a backend still loading or failing to load shows one placeholder row. The active
 * session's model is always present, at the end of its own agent's section.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function buildPickerEntries(
  backends: readonly BackendSummary[],
  active: PickerActiveSession | null
): PickerEntries {
  const entries: PickerModel[] = [];
  const sectionEnds = new Map<string, number>();
  const activeModel = active?.modelState ?? null;
  for (const backend of backends) {
    const isActiveBackend = backend.id === active?.backendId;
    if (!isActiveBackend && active?.hasHistory) continue;
    const keepBaseModelId = isActiveBackend
      ? (activeModel?.current.baseModelId ?? null)
      : (backend.defaultSelection?.baseModelId ?? null);
    const hasNoCatalog = backend.reported === null;
    const settled = backend.preload === "ready" || backend.preload === "error";
    const sectionStart = entries.length;
    appendSection(entries, backend, keepBaseModelId, hasNoCatalog && settled);
    if (hasNoCatalog && entries.length === sectionStart) {
      if (backend.preload === "pending") entries.push(placeholder(backend, true));
      else if (settled) entries.push(placeholder(backend, false));
    }
    if (!isActiveBackend) {
      const reason = readinessReason(backend.readiness);
      if (reason) {
        for (let i = sectionStart; i < entries.length; i++) entries[i].disabledReason = reason;
      }
    }
    if (backend.selfHostWarning) {
      for (let i = sectionStart; i < entries.length; i++) entries[i].needsSelfHostWarning = true;
    }
    if (backend.lockedPreview.length > 0) {
      entries.splice(sectionStart, 0, ...backend.lockedPreview);
    }
    sectionEnds.set(backend.id, entries.length);
  }

  const current = activeModel?.current;
  const currentEntry = activeModel?.availableModels.find(
    (model) => model.baseModelId === current?.baseModelId
  );
  const activeBackend = backends.find((backend) => backend.id === active?.backendId);
  if (!active || !activeBackend || !current || !currentEntry) return { entries, selected: null };

  const match = entries.find(
    (entry) => entry.backendId === active.backendId && baseModelIdOf(entry) === current.baseModelId
  );
  if (match) return { entries, selected: match };
  const stranded = agentPickerModel(activeBackend, current.baseModelId, currentEntry.name, {
    subtitle: currentEntry.description,
  });
  if (activeBackend.selfHostWarning) stranded.needsSelfHostWarning = true;
  entries.splice(sectionEnds.get(active.backendId) ?? entries.length, 0, stranded);
  return { entries, selected: stranded };
}

export function resolveEfforts(
  backends: readonly BackendSummary[],
  backendId: BackendId,
  baseModelId: string
): readonly EffortOption[] {
  return (
    backends.find((backend) => backend.id === backendId)?.efforts[baseModelId] ??
    EMPTY_EFFORT_OPTIONS
  );
}

export interface EffortSibling {
  options: readonly EffortOption[];
  value: string | null;
  disabled: boolean;
}

export function buildEffortSibling(
  modelState: ModelState | null,
  canSwitchEffort: boolean | null
): EffortSibling | null {
  const current = modelState?.current;
  const entry: ModelEntry | undefined = modelState?.availableModels.find(
    (model) => model.baseModelId === current?.baseModelId
  );
  if (!modelState || !current || !entry || entry.effortOptions.length === 0) return null;
  return {
    options: entry.effortOptions,
    value: current.effort,
    disabled: canSwitchEffort === false,
  };
}
