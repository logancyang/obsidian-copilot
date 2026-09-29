import { logError } from "@/logger";
import { App, Modal } from "obsidian";
import type { BackendId, Skill } from "@/agentMode/skills/types";

export type MigrateConfirmVariant =
  | "project-single"
  | "project-mirrored"
  | "disable-last-agent"
  | "proactive-consolidate";

export interface MigrateActionLine {
  verb: string;
  detail: string;
  note?: string;
}

export interface MigrateSkillConfirmModalArgs {
  variant: MigrateConfirmVariant;
  skill: Skill;
  targetAgent: BackendId | null;
  targetAgentDisplayName?: string;
  resolvedCanonicalName: string;
  sourceDuplicatePaths: ReadonlyArray<string>;
  actionLines: ReadonlyArray<MigrateActionLine>;
  onConfirm: (suppressFuture: boolean) => void | Promise<void>;
  onCancel?: () => void;
}

export class MigrateSkillConfirmModal extends Modal {
  private readonly args: MigrateSkillConfirmModalArgs;
  private confirmed = false;
  private suppressFuture = false;

  constructor(app: App, args: MigrateSkillConfirmModalArgs) {
    super(app);
    this.args = args;
    // @ts-ignore - setTitle is documented but missing from the typings.
    this.setTitle(buildTitle(args));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-gap-3");

    const bodyEl = contentEl.createEl("p", {
      cls: "tw-m-0 tw-text-ui-smaller tw-text-normal tw-whitespace-pre-line",
      text: buildBody(this.args),
    });
    bodyEl.setAttr("data-test-id", "migrate-confirm-body");

    if (this.args.sourceDuplicatePaths.length > 0) {
      const list = contentEl.createEl("ul", {
        cls: "tw-m-0 tw-list-none tw-space-y-1 tw-pl-0 tw-font-mono tw-text-ui-smaller tw-text-normal",
      });
      for (const path of this.args.sourceDuplicatePaths) {
        const li = list.createEl("li", {
          cls: "tw-flex tw-items-baseline tw-gap-2",
        });
        li.createSpan({ cls: "tw-text-faint", text: "•" });
        li.createSpan({ cls: "tw-flex-1", text: path });
      }
    }

    if (this.args.resolvedCanonicalName !== this.args.skill.name) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-warning",
        text:
          `The name "${this.args.skill.name}" is already taken in your shared folder. ` +
          `The migrated skill will be named "${this.args.resolvedCanonicalName}".`,
      });
    }

    const willHeader = contentEl.createDiv({
      cls: "tw-text-ui-smaller tw-text-muted",
      text: "Copilot will:",
    });
    willHeader.setAttr("data-test-id", "migrate-confirm-will-header");
    const actionList = contentEl.createEl("ul", {
      cls: "tw-m-0 tw-list-none tw-space-y-1 tw-pl-0 tw-font-mono tw-text-ui-smaller tw-text-normal",
    });
    for (const line of this.args.actionLines) {
      const li = actionList.createEl("li", {
        cls: "tw-flex tw-items-baseline tw-gap-2",
      });
      li.createSpan({ cls: "tw-text-faint", text: "•" });
      const body = li.createSpan({ cls: "tw-flex-1" });
      body.createSpan({
        cls: "tw-inline-block tw-min-w-[64px] tw-text-muted",
        text: line.verb,
      });
      body.createSpan({ text: ` ${line.detail}` });
      if (line.note !== undefined && line.note.length > 0) {
        body.createSpan({
          cls: "tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint",
          text: line.note,
        });
      }
    }

    const outro = buildOutro(this.args);
    if (outro !== null) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-muted tw-whitespace-pre-line",
        text: outro,
      });
    }

    const checkboxRow = contentEl.createEl("label", {
      cls: "tw-flex tw-items-center tw-gap-2 tw-text-ui-smaller tw-text-normal tw-cursor-pointer",
    });
    const checkbox = checkboxRow.createEl("input", {
      cls: "tw-size-checkbox",
      attr: { type: "checkbox" },
    });
    checkbox.addEventListener("change", () => {
      this.suppressFuture = checkbox.checked;
    });
    checkboxRow.createSpan({ text: "Don't ask again for future migrations" });

    const buttonRow = contentEl.createDiv({
      cls: "tw-flex tw-justify-end tw-gap-2 tw-pt-2",
    });
    const cancelBtn = buttonRow.createEl("button", {
      cls: "mod-secondary",
      text: "Cancel",
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
    const confirmBtn = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: buildConfirmLabel(this.args),
    });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      const result = this.args.onConfirm(this.suppressFuture);
      if (result instanceof Promise) {
        result.catch((err) => logError("MigrateSkillConfirmModal onConfirm failed", err));
      }
      this.close();
    });
  }

  onClose(): void {
    if (!this.confirmed) {
      this.args.onCancel?.();
    }
    this.contentEl.empty();
  }
}

function buildTitle(args: MigrateSkillConfirmModalArgs): string {
  const name = args.skill.name;
  switch (args.variant) {
    case "project-single":
      return `Move "${name}" to share with ${args.targetAgentDisplayName ?? "another agent"}?`;
    case "project-mirrored":
      return `Consolidate "${name}" and share with ${args.targetAgentDisplayName ?? "another agent"}?`;
    case "disable-last-agent":
      return `Move "${name}" to your shared folder before disabling ${
        args.targetAgentDisplayName ?? "this agent"
      }?`;
    case "proactive-consolidate":
      return `Consolidate "${name}" into your shared folder?`;
  }
}

function buildBody(args: MigrateSkillConfirmModalArgs): string {
  const target = args.targetAgentDisplayName ?? "another agent";
  switch (args.variant) {
    case "project-single":
      return (
        `This skill currently lives only in your ${sourceAgentLabel(args)} project folder.\n` +
        `To enable it for ${target}, Copilot needs to move it to a shared location\n` +
        `so both agents stay in sync.`
      );
    case "project-mirrored":
      return `The same skill is currently duplicated in ${pluralFolders(args.sourceDuplicatePaths.length)}:`;
    case "disable-last-agent":
      return `This skill currently lives only in:`;
    case "proactive-consolidate":
      return `The same skill is currently duplicated in:`;
  }
}

function buildOutro(args: MigrateSkillConfirmModalArgs): string | null {
  const source = args.targetAgentDisplayName ?? "this agent";
  switch (args.variant) {
    case "project-single":
      return (
        `You can still edit the skill exactly as before — there's just one copy now,\n` +
        `so changes are visible to both agents immediately.`
      );
    case "project-mirrored":
      return `After this, edits to the skill are visible to all ${args.actionLines.filter((l) => l.verb === "Create").length} agents.`;
    case "disable-last-agent":
      return (
        `If you disable ${source}, the file has nowhere to live in its project folder.\n` +
        `Copilot can preserve it by moving the skill to your shared skills folder with\n` +
        `no agents enabled — you can toggle agents back on any time, or delete it later\n` +
        `from the Skills tab.`
      );
    case "proactive-consolidate":
      return (
        `Editing, renaming, or deleting one copy would silently diverge from the others.\n` +
        `Copilot can consolidate them into a single shared location, with a shortcut in\n` +
        `each agent folder so all agents still see the skill.\n\n` +
        `After this, your edits stay in sync across all agents automatically.`
      );
  }
}

function buildConfirmLabel(args: MigrateSkillConfirmModalArgs): string {
  const target = args.targetAgentDisplayName ?? "agent";
  switch (args.variant) {
    case "project-single":
    case "project-mirrored":
      return `Move and enable ${target}`;
    case "disable-last-agent":
      return `Move and disable ${target}`;
    case "proactive-consolidate":
      return "Consolidate";
  }
}

function sourceAgentLabel(args: MigrateSkillConfirmModalArgs): string {
  if (args.skill.location.kind !== "project") return "agent";
  const [first] = args.skill.location.agentDirs;
  return first ?? "agent";
}

function pluralFolders(n: number): string {
  if (n === 2) return "two project folders";
  if (n === 3) return "three project folders";
  return `${n} project folders`;
}
