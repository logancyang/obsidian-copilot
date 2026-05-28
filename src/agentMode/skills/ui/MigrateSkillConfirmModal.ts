import { logError } from "@/logger";
import { App, Modal } from "obsidian";
import type { BackendId, Skill } from "@/agentMode/skills/types";

/**
 * Which migration scenario the modal is confirming. Drives the title,
 * body paragraph, and primary-button label. See §8 of the Skills
 * Discovery Redesign for the canonical copy of every variant.
 *
 *   - `project-single` — skill currently lives in one agent's project
 *     folder; user toggled ON a different agent. Action: move to canonical
 *     and create shortcuts for both.
 *   - `project-mirrored` — skill is duplicated identically across two or
 *     more agent project folders; user toggled ON a new agent. Action:
 *     replace duplicates with one canonical copy plus shortcuts.
 *   - `disable-last-agent` — skill currently lives only in one (or one
 *     surviving) agent project folder; user toggled the last agent OFF.
 *     Action: preserve the SKILL.md by moving to canonical with no agents.
 *   - `proactive-consolidate` — skill is project-mirrored across two or
 *     more agents; user clicked the overflow menu's Migrate entry. Action:
 *     consolidate into canonical with shortcuts for every current agent.
 */
export type MigrateConfirmVariant =
  | "project-single"
  | "project-mirrored"
  | "disable-last-agent"
  | "proactive-consolidate";

/**
 * One line of the "Copilot will:" action list inside the body. Rendered
 * as a monospaced bullet with an optional inline note (e.g. "(identical
 * duplicate)") that the caller supplies verbatim.
 */
export interface MigrateActionLine {
  /** Action verb shown in a fixed-width left column (`Move`, `Delete`, `Create`, `Not create`). */
  verb: string;
  /** Primary path or compound `from → to` text shown next to the verb. */
  detail: string;
  /** Optional inline note, e.g. `"(identical duplicate)"` or `"(shortcut to the new location)"`. */
  note?: string;
}

/**
 * Constructor arguments. The caller is responsible for resolving all
 * dynamic copy (paths, collision-suffixed name, target agent display
 * name) so this modal stays a dumb renderer.
 */
export interface MigrateSkillConfirmModalArgs {
  /** Which variant of the dialog to render. */
  variant: MigrateConfirmVariant;
  /** Source skill being migrated; used for the title (`Move "foo" …`). */
  skill: Skill;
  /**
   * The agent being toggled in this flow. Required for `project-single`
   * and `project-mirrored` (the agent being toggled ON) and for
   * `disable-last-agent` (the agent being toggled OFF — drives the
   * button label). `null` for `proactive-consolidate`.
   */
  targetAgent: BackendId | null;
  /** Human-readable name of `targetAgent` (e.g. `"Codex"`); ignored when `targetAgent` is null. */
  targetAgentDisplayName?: string;
  /**
   * Final canonical name after `suffixOnCollision`. Equals `skill.name`
   * unless the collision-preamble fires.
   */
  resolvedCanonicalName: string;
  /**
   * For mirrored variants, the absolute path of each existing duplicate
   * to list in the body's "currently duplicated in:" bullets. Leave
   * empty for `project-single` (the source path lives inside the action
   * list as the move's left-hand side).
   */
  sourceDuplicatePaths: ReadonlyArray<string>;
  /** Rendered as the "Copilot will:" action list. */
  actionLines: ReadonlyArray<MigrateActionLine>;
  /**
   * Confirm callback. Receives the live state of the "Don't ask again"
   * checkbox so the caller can persist `suppressMigrationConfirm`.
   * Awaited; rejection is logged but does not block close.
   */
  onConfirm: (suppressFuture: boolean) => void | Promise<void>;
  /** Optional cancel callback. Fires on Cancel button OR ESC/click-outside. */
  onCancel?: () => void;
}

/**
 * Confirmation dialog for any migration of a project-managed skill
 * into the canonical folder. Native Obsidian `Modal` — no React tree
 * to keep the migration flow independent of the Skills tab's lifecycle
 * (the modal can outlive a tab tear-down).
 *
 * Variants share one DOM scaffold; only the title, body paragraph,
 * source-duplicate list (when present), and confirm-button label
 * differ. See §8 of `designdocs/SKILLS_DISCOVERY_REDESIGN.md` for the
 * verbatim copy of every variant.
 */
export class MigrateSkillConfirmModal extends Modal {
  private readonly args: MigrateSkillConfirmModalArgs;
  /** Set to true exactly when the user clicks Confirm — gates onCancel. */
  private confirmed = false;
  /** Checkbox state, captured from the rendered input on Confirm. */
  private suppressFuture = false;

  constructor(app: App, args: MigrateSkillConfirmModalArgs) {
    super(app);
    this.args = args;
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore - setTitle is documented but missing from the typings.
    this.setTitle(buildTitle(args));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-gap-3");

    // Body paragraph — variant-specific intro.
    const bodyEl = contentEl.createEl("p", {
      cls: "tw-m-0 tw-text-ui-smaller tw-text-normal tw-whitespace-pre-line",
      text: buildBody(this.args),
    });
    bodyEl.setAttr("data-test-id", "migrate-confirm-body");

    // Mirrored-source path list (only when there are duplicates to enumerate).
    if (this.args.sourceDuplicatePaths.length > 0) {
      const list = contentEl.createEl("ul", {
        cls: "tw-m-0 tw-list-none tw-space-y-1 tw-pl-0 tw-font-mono tw-text-ui-smaller tw-text-normal",
      });
      for (const path of this.args.sourceDuplicatePaths) {
        const li = list.createEl("li", {
          cls: "tw-flex tw-items-baseline tw-gap-2",
        });
        li.createEl("span", { cls: "tw-text-faint", text: "•" });
        li.createEl("span", { cls: "tw-flex-1", text: path });
      }
    }

    // Collision-suffix preamble — appears only when canonical name was
    // suffixed (e.g. `foo` was taken, resolved to `foo-2`).
    if (this.args.resolvedCanonicalName !== this.args.skill.name) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-warning",
        text:
          `The name "${this.args.skill.name}" is already taken in your shared folder. ` +
          `The migrated skill will be named "${this.args.resolvedCanonicalName}".`,
      });
    }

    // "Copilot will:" action list.
    const willHeader = contentEl.createEl("div", {
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
      li.createEl("span", { cls: "tw-text-faint", text: "•" });
      const body = li.createEl("span", { cls: "tw-flex-1" });
      body.createEl("span", {
        cls: "tw-inline-block tw-min-w-[64px] tw-text-muted",
        text: line.verb,
      });
      body.createEl("span", { text: ` ${line.detail}` });
      if (line.note !== undefined && line.note.length > 0) {
        body.createEl("span", {
          cls: "tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint",
          text: line.note,
        });
      }
    }

    // Outro paragraph — variant-specific tail (e.g. "After this, edits …").
    const outro = buildOutro(this.args);
    if (outro !== null) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-muted tw-whitespace-pre-line",
        text: outro,
      });
    }

    // "Don't ask again" checkbox.
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
    checkboxRow.createEl("span", { text: "Don't ask again for future migrations" });

    // Buttons.
    const buttonRow = contentEl.createEl("div", {
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
    // Either a click on Cancel, the ESC key, or a click outside — fire the
    // caller's cancel hook only when Confirm was NOT clicked, so the caller
    // can revert any speculative toggle UI state.
    if (!this.confirmed) {
      this.args.onCancel?.();
    }
    this.contentEl.empty();
  }
}

/** Title varies by variant; verbatim per §8 of the design doc. */
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

/** Body paragraph varies by variant; verbatim per §8 of the design doc. */
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

/** Outro paragraph varies by variant; per §8 of the design doc. */
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

/** Confirm-button label varies by variant; verbatim per §8 of the design doc. */
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

/**
 * Source-agent label for the project-single body paragraph. Derives from
 * `skill.location` rather than `targetAgent` because the source is the
 * one agent the skill currently lives under.
 */
function sourceAgentLabel(args: MigrateSkillConfirmModalArgs): string {
  if (args.skill.location.kind !== "project") return "agent";
  const [first] = args.skill.location.agentDirs;
  return first ?? "agent";
}

/** Format the duplicate-folder count for the project-mirrored body. */
function pluralFolders(n: number): string {
  if (n === 2) return "two project folders";
  if (n === 3) return "three project folders";
  return `${n} project folders`;
}
