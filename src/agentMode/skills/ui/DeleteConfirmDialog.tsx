import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { AlertTriangle } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import type { BackendId, Skill } from "@/agentMode/skills/types";

/**
 * Body of the delete confirmation modal. Enumerates every concrete path
 * that will be removed (canonical dir + each agent symlink currently in
 * `copilot-enabled-agents`) so the user can verify the blast radius
 * before confirming. Mirrors wireframe state G.
 */
const DeleteConfirmBody: React.FC<{
  skill: Skill;
  skillsFolderRel: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ skill, skillsFolderRel, agentDirsProjectRel, onCancel, onConfirm }) => {
  const folder = skillsFolderRel.replace(/\/+$/, "");
  const paths = collectDeletePaths(skill, folder, agentDirsProjectRel);
  const isProject = skill.location.kind === "project";

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div
        className={cn(
          "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-px-3.5 tw-py-2.5",
          "tw-border tw-border-solid tw-bg-modifier-error-rgb/15 tw-border-modifier-error/80"
        )}
      >
        <AlertTriangle
          className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error"
          aria-hidden="true"
        />
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-normal">
          {isProject
            ? `This removes the skill ${paths.length > 1 ? "folders" : "folder"} from your project. Vault sync / git is the only rollback path.`
            : "This removes the canonical copy and every agent symlink. Vault sync / git is the only rollback path."}
        </p>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-text-ui-smaller tw-text-muted">Will remove:</div>
        <ul className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0 tw-font-mono tw-text-ui-smaller tw-text-normal">
          {paths.map(({ path, note }) => (
            <li key={path} className="tw-flex tw-items-baseline tw-gap-2">
              <span className="tw-text-faint">•</span>
              <span className="tw-flex-1">
                {path}
                {note !== null && (
                  <span className="tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint">
                    {note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete skill
        </Button>
      </div>
    </div>
  );
};

/**
 * Native Obsidian delete confirmation modal for a managed skill. Built on
 * Obsidian's `Modal` for popout-window safety, native header chrome, and
 * ESC handling — consistent with the rest of the plugin's confirm flows
 * (see `src/components/modals/ConfirmModal.tsx`).
 */
export class DeleteConfirmModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly skill: Skill,
    private readonly skillsFolderRel: string,
    private readonly agentDirsProjectRel: Readonly<Record<BackendId, string>>,
    private readonly onConfirm: () => void | Promise<void>
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(`Delete ${skill.name}?`);
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <DeleteConfirmBody
        skill={this.skill}
        skillsFolderRel={this.skillsFolderRel}
        agentDirsProjectRel={this.agentDirsProjectRel}
        onCancel={() => this.close()}
        onConfirm={() => {
          const result = this.onConfirm();
          if (result instanceof Promise) {
            result.catch((err) => logError("DeleteConfirmModal onConfirm failed", err));
          }
          this.close();
        }}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
  }
}

/**
 * Build the bullet list shown in the body, scoped to exactly what
 * `SkillManager.deleteSkill` → `runDeleteSkill` removes:
 *
 *   - Canonical skills: the canonical dir, then one symlink line per
 *     enabled agent.
 *   - Project skills: the real `SKILL.md` directory inside each owning
 *     agent's project folder. There is no canonical copy and no symlink
 *     to remove — `removeAgentLink` explicitly refuses to touch real
 *     directories, so listing those here would misrepresent the blast
 *     radius.
 */
function collectDeletePaths(
  skill: Skill,
  folder: string,
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): Array<{ path: string; note: string | null }> {
  const out: Array<{ path: string; note: string | null }> = [];

  if (skill.location.kind === "project") {
    for (const agent of skill.location.agentDirs) {
      const dir = agentDirsProjectRel[agent];
      if (dir === undefined) continue;
      out.push({
        path: `${dir.replace(/\/+$/, "")}/${skill.name}/`,
        note: "project SKILL.md and supporting files",
      });
    }
    return out;
  }

  out.push({
    path: `${folder}/${skill.name}/`,
    note: "canonical SKILL.md and supporting files",
  });
  for (const agent of skill.enabledAgents) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({ path: `${dir}/${skill.name}`, note: "symlink" });
  }
  return out;
}
