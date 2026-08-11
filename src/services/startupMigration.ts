export type StartupMigrationStatus = "success" | "action-required" | "error";

/** One user-facing outcome collected for the startup migration summary. */
export interface StartupMigrationItem {
  id: string;
  title: string;
  status: StartupMigrationStatus;
  summary: string;
  details?: string[];
}

/** One independently started migration and the result to show if it fails. */
export interface StartupMigrationTask {
  result: Promise<StartupMigrationItem | null>;
  failure: StartupMigrationItem | null;
  onFailure(error: unknown): void;
}

/** Every layout-ready migration that must settle before the summary opens. */
export type StartupMigrationTasks = readonly [
  projects: StartupMigrationTask,
  commands: StartupMigrationTask,
  prompts: StartupMigrationTask,
  folders: StartupMigrationTask,
];

/** Inputs needed to settle startup work and present one summary. */
export interface StartupMigrationPlan {
  initialItems: readonly StartupMigrationItem[];
  tasks: StartupMigrationTasks;
  afterTasks(): readonly (StartupMigrationItem | null)[];
  present(items: readonly StartupMigrationItem[]): void;
  acknowledge(items: readonly StartupMigrationItem[]): void;
}

const STATUS_LABELS: Record<StartupMigrationStatus, string> = {
  success: "Completed",
  "action-required": "Action required",
  error: "Failed",
};

/** Format migration outcomes for the existing confirmation modal. */
export function formatStartupMigrationSummary(items: readonly StartupMigrationItem[]): string {
  const sections = items.map((item) =>
    [
      `${item.title} — ${STATUS_LABELS[item.status]}`,
      item.summary,
      ...(item.details ?? []).map((detail) => `• ${detail}`),
    ].join("\n")
  );
  return ["Copilot finished updating this vault.", ...sections].join("\n\n");
}

/** Whether this device may clear its credential-recovery receipt. */
export function shouldClearCredentialRecovery(
  items: readonly StartupMigrationItem[],
  recoveryDeviceId: string | undefined,
  currentDeviceId: string
): boolean {
  return recoveryDeviceId === currentDeviceId && items.some(({ id }) => id === "credentials");
}

/** Whether successfully presented folder guidance may clear its upgrade flag. */
export function shouldClearFolderRelocation(items: readonly StartupMigrationItem[]): boolean {
  return items.some(({ id, status }) => id === "folders" && status !== "error");
}

/** Settle every migration before presenting and acknowledging one combined summary. */
export async function runStartupMigrationSummary(plan: StartupMigrationPlan): Promise<void> {
  const settled = await Promise.all(
    plan.tasks.map(async (task) => {
      try {
        return await task.result;
      } catch (error) {
        task.onFailure(error);
        return task.failure;
      }
    })
  );
  const items = [...plan.initialItems, ...settled, ...plan.afterTasks()].filter(
    (item): item is StartupMigrationItem => item !== null
  );
  if (items.length === 0) return;

  plan.present(items);
  plan.acknowledge(items);
}
