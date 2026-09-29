export type StartupMigrationStatus = "success" | "action-required" | "error";

export interface StartupMigrationItem {
  id: string;
  title: string;
  status: StartupMigrationStatus;
  summary: string;
  details?: string[];
}

export interface StartupMigrationTask {
  result: Promise<StartupMigrationItem | null>;
  failure: StartupMigrationItem | null;
  onFailure(error: unknown): void;
}

export type StartupMigrationTasks = readonly [
  projects: StartupMigrationTask,
  commands: StartupMigrationTask,
  prompts: StartupMigrationTask,
  folders: StartupMigrationTask,
];

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

export function shouldClearCredentialRecovery(
  items: readonly StartupMigrationItem[],
  recoveryDeviceId: string | undefined,
  currentDeviceId: string
): boolean {
  return recoveryDeviceId === currentDeviceId && items.some(({ id }) => id === "credentials");
}

export function shouldClearFolderRelocation(items: readonly StartupMigrationItem[]): boolean {
  return items.some(({ id, status }) => id === "folders" && status !== "error");
}

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
