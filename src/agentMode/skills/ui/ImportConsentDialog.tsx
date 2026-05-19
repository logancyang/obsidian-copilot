import { AgentIconButton } from "./AgentIconButton";
import type { BulkMoveResult, BulkMoveRow } from "@/agentMode/skills/bulkMove";
import { totalCandidates, type ImportDetectorResult } from "@/agentMode/skills/importDetector";
import type { ImportCandidate } from "@/agentMode/skills/types";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { withTrailingSlash } from "@/utils/pathUtils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Loader2 } from "lucide-react";
import { App, Modal } from "obsidian";
import React, { useEffect, useRef } from "react";
import { Root } from "react-dom/client";

/**
 * Phase of the import consent flow. Mirrors wireframe states B (consent)
 * and C (results) plus a running spinner between them.
 */
export type ImportPhase = "consent" | "running" | "results";

interface ImportConsentDialogProps {
  /** Controls the modal open state. */
  open: boolean;
  /** Called when the modal wants to close (ESC, overlay click, X). */
  onOpenChange: (open: boolean) => void;
  /** Current dialog phase. */
  phase: ImportPhase;
  /**
   * Brand projection of every registered backend, supplied by the host.
   * Drives the per-agent groupings and the brand glyph rendered in each
   * group header. The dialog never enumerates backends itself.
   */
  agents: ReadonlyArray<AgentBrand>;
  /** Candidates from the detector, grouped by source agent. */
  candidates: ImportDetectorResult;
  /** Filled in when phase === "results". */
  results: BulkMoveResult | null;
  /** Configured canonical folder — interpolated into the results headline. */
  folder: string;
  /**
   * Project-relative skills directory per registered backend, sourced from
   * each `BackendDescriptor.skillsProjectDir`. Used to label source groups
   * and the failure footnote so the dialog matches the live registry rather
   * than hard-coded paths.
   */
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  /** Primary action — runs the bulk move. */
  onConfirm: () => void;
  /** Secondary action — closes without moving. */
  onDismiss: () => void;
  /** Done action on the results screen. */
  onDone: () => void;
  /**
   * Open a SKILL.md (absolute path) in Obsidian's editor — wired to the
   * same opener as the skills grid so a failed-import row can offer an
   * "Edit SKILL.md" affordance.
   */
  onEditSkillMd: (absPath: string) => void;
}

type PhaseRenderProps = Omit<ImportConsentDialogProps, "open" | "onOpenChange">;

/**
 * Consent + results modal for the bulk import flow. Matches the
 * wireframe B (consent) and C (results) states in
 * `tmp/skills-design/copilot-skills-settings/project/Skills Tab Flows.html`.
 *
 * Rendered on Obsidian's native {@link Modal} per the layer rules in
 * `src/agentMode/CLAUDE.md`: popout-window safety, native header chrome,
 * and ESC handling come for free. The single modal instance is kept open
 * across phase transitions so the surface feels like it's evolving.
 */
export const ImportConsentDialog: React.FC<ImportConsentDialogProps> = (props) => {
  const { open } = props;
  const modalRef = useRef<ImportConsentObsidianModal | null>(null);

  // Latest props for the modal's close callback — captured via ref so we
  // don't tear down and reopen the modal whenever a handler identity
  // changes.
  const propsRef = useRef(props);
  propsRef.current = props;

  // Mount / unmount the underlying Obsidian modal in response to `open`.
  useEffect(() => {
    if (open && modalRef.current === null) {
      const modal = new ImportConsentObsidianModal(app, () => {
        propsRef.current.onOpenChange(false);
      });
      modalRef.current = modal;
      modal.open();
      modal.renderPhase(propsRef.current);
    } else if (!open && modalRef.current !== null) {
      const modal = modalRef.current;
      modalRef.current = null;
      modal.closeWithoutCallback();
    }
  }, [open]);

  // Re-render content (and re-title) on prop change while the modal is open.
  useEffect(() => {
    if (modalRef.current !== null) {
      modalRef.current.renderPhase(props);
    }
  });

  // Close the modal on unmount so a remounted tab doesn't leak the surface.
  useEffect(() => {
    return () => {
      if (modalRef.current !== null) {
        const modal = modalRef.current;
        modalRef.current = null;
        modal.closeWithoutCallback();
      }
    };
  }, []);

  return null;
};

/**
 * Native Obsidian modal shell for the import flow. Owns its own React
 * root and exposes `renderPhase` so the React wrapper can drive title +
 * body updates without rebuilding the modal across phase transitions.
 */
class ImportConsentObsidianModal extends Modal {
  private root: Root | null = null;
  private suppressRequestClose = false;

  constructor(
    app: App,
    private readonly requestClose: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    if (!this.suppressRequestClose) {
      this.requestClose();
    }
  }

  /**
   * Close the modal without firing the `requestClose` callback. Used when
   * the React controller is closing the modal in response to its own
   * `open` prop flipping false — the parent already knows about the state
   * change, so re-notifying would re-enter `handleOpenChange` and call
   * the dismiss handler after a successful `Done`.
   */
  closeWithoutCallback(): void {
    this.suppressRequestClose = true;
    this.close();
  }

  renderPhase(props: PhaseRenderProps): void {
    if (this.root === null) return;
    const title = computeTitle(props);
    // @ts-expect-error — setTitle exists on Modal but is missing from @types/obsidian.
    this.setTitle(title);

    if (props.phase === "consent") {
      this.root.render(
        <ConsentBody
          agents={props.agents}
          candidates={props.candidates}
          total={totalCandidates(props.candidates)}
          agentDirsProjectRel={props.agentDirsProjectRel}
          onConfirm={props.onConfirm}
          onDismiss={props.onDismiss}
        />
      );
      return;
    }
    if (props.phase === "running") {
      this.root.render(<RunningBody />);
      return;
    }
    if (props.results !== null) {
      this.root.render(
        <ResultsBody
          agents={props.agents}
          results={props.results}
          agentDirsProjectRel={props.agentDirsProjectRel}
          onDone={props.onDone}
          onEditSkillMd={props.onEditSkillMd}
        />
      );
    }
  }
}

function computeTitle(props: PhaseRenderProps): string {
  if (props.phase === "consent") {
    return "You already have some skills in this vault";
  }
  if (props.phase === "running") {
    const total = totalCandidates(props.candidates);
    return `Moving ${total} ${total === 1 ? "skill" : "skills"}…`;
  }
  const moved =
    props.results === null ? 0 : props.results.results.filter((r) => r.status === "moved").length;
  const folder = props.folder.replace(/\/+$/, "");
  return `Moved ${moved} ${moved === 1 ? "skill" : "skills"} into ${folder}/`;
}

/* --- Consent (state B) ---------------------------------------------- */

interface ConsentBodyProps {
  agents: ReadonlyArray<AgentBrand>;
  candidates: ImportDetectorResult;
  total: number;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onConfirm: () => void;
  onDismiss: () => void;
}

const ConsentBody: React.FC<ConsentBodyProps> = ({
  agents,
  candidates,
  total,
  agentDirsProjectRel,
  onConfirm,
  onDismiss,
}) => {
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        We spotted {total} {total === 1 ? "skill" : "skills"} tucked inside your agent folders.
        Copilot can bring them together in one place so it&apos;s easier to see them, share them
        across agents, and tweak them.
      </p>

      <div className="tw-flex tw-flex-col tw-gap-3">
        {agents.map((agent) => {
          const items = candidates[agent.id] ?? [];
          if (items.length === 0) return null;
          return (
            <SourceGroup
              key={agent.id}
              agent={agent}
              path={withTrailingSlash(agentDirsProjectRel[agent.id] ?? "")}
              items={items}
            />
          );
        })}
      </div>

      <p className="tw-m-0 tw-text-xs tw-leading-relaxed tw-text-muted">
        Your agents will keep working exactly the same — we just leave shortcuts behind so nothing
        breaks. If two skills share a name we&apos;ll add a small suffix (
        <span className="tw-font-mono">foo-2</span>, <span className="tw-font-mono">foo-3</span>,
        …).
      </p>

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="secondary" onClick={onDismiss}>
          Not now
        </Button>
        <Button variant="default" onClick={onConfirm}>
          Bring them together →
        </Button>
      </div>
    </div>
  );
};

interface SourceGroupProps {
  agent: AgentBrand;
  path: string;
  items: ImportCandidate[];
}

const SourceGroup: React.FC<SourceGroupProps> = ({ agent, path, items }) => {
  return (
    <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-2.5">
      <div className="tw-mb-1.5 tw-flex tw-items-center tw-gap-2">
        <AgentIconButton
          Icon={agent.Icon}
          agentId={agent.id}
          agentName={agent.displayName}
          enabled
          size="sm"
        />
        <span className="tw-text-sm tw-font-medium tw-text-normal">From {agent.displayName}</span>
        <span className="tw-flex-1" />
        <span className="tw-font-mono tw-text-xs tw-text-faint">{path}</span>
      </div>
      <ul className="tw-m-0 tw-list-none tw-space-y-0.5 tw-p-0">
        {items.map((item) => (
          <li
            key={item.sourcePath}
            className="tw-flex tw-items-center tw-gap-2 tw-py-0.5 tw-text-xs"
          >
            <span className="tw-font-mono tw-text-normal">{item.name}</span>
            <span className="tw-flex-1" />
            <span className="tw-font-mono tw-text-[10.5px] tw-text-faint">
              {item.fileCount} {item.fileCount === 1 ? "file" : "files"} ·{" "}
              {formatBytes(item.totalBytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* --- Running ---------------------------------------------------------- */

const RunningBody: React.FC = () => {
  return (
    <div className="tw-flex tw-items-center tw-justify-center tw-py-6 tw-text-muted">
      <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
      <span className="tw-text-sm">Working…</span>
    </div>
  );
};

/* --- Results (state C) ---------------------------------------------- */

interface ResultsBodyProps {
  agents: ReadonlyArray<AgentBrand>;
  results: BulkMoveResult;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onDone: () => void;
  onEditSkillMd: (absPath: string) => void;
}

const ResultsBody: React.FC<ResultsBodyProps> = ({
  agents,
  results,
  agentDirsProjectRel,
  onDone,
  onEditSkillMd,
}) => {
  const failedRows = results.results.filter((r) => r.status !== "moved");
  const byAgent = groupRowsByAgent(results.results);

  // Construct the failure-summary micro footnote dynamically. Only renders
  // when at least one row didn't make it.
  const failureSummary = buildFailureSummary(failedRows, agentDirsProjectRel);

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div className="tw-flex tw-flex-col tw-gap-3">
        {agents.map((agent) => {
          const rows = byAgent[agent.id] ?? [];
          if (rows.length === 0) return null;
          return (
            <ResultGroup key={agent.id} agent={agent} rows={rows} onEditSkillMd={onEditSkillMd} />
          );
        })}
      </div>

      {failureSummary !== null && (
        <p className="tw-m-0 tw-text-xs tw-leading-relaxed tw-text-muted">{failureSummary}</p>
      )}

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="default" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
};

interface ResultGroupProps {
  agent: AgentBrand;
  rows: BulkMoveRow[];
  onEditSkillMd: (absPath: string) => void;
}

const ResultGroup: React.FC<ResultGroupProps> = ({ agent, rows, onEditSkillMd }) => {
  return (
    <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-2.5">
      <div className="tw-mb-1.5 tw-flex tw-items-center tw-gap-2">
        <AgentIconButton
          Icon={agent.Icon}
          agentId={agent.id}
          agentName={agent.displayName}
          enabled
          size="sm"
        />
        <span className="tw-text-sm tw-font-medium tw-text-normal">From {agent.displayName}</span>
      </div>
      <ul className="tw-m-0 tw-list-none tw-space-y-0.5 tw-p-0">
        {rows.map((row) => (
          <li
            key={row.candidate.sourcePath}
            className="tw-flex tw-items-center tw-gap-2 tw-py-0.5 tw-text-xs"
          >
            <span className="tw-font-mono tw-text-normal">{row.targetName}</span>
            <span className="tw-flex-1" />
            <ResultBadge row={row} onEditSkillMd={onEditSkillMd} />
          </li>
        ))}
      </ul>
    </div>
  );
};

const ResultBadge: React.FC<{
  row: BulkMoveRow;
  onEditSkillMd: (absPath: string) => void;
}> = ({ row, onEditSkillMd }) => {
  if (row.status === "moved") {
    return <span className="tw-font-mono tw-text-[10.5px] tw-text-success">✓ moved</span>;
  }

  const editLink =
    row.failingSkillMdAbsPath !== undefined ? (
      <EditSkillMdLink absPath={row.failingSkillMdAbsPath} onEditSkillMd={onEditSkillMd} />
    ) : null;

  if (row.status === "epermNoLink") {
    return (
      <span className="tw-flex tw-items-center tw-gap-2">
        <span className="tw-font-mono tw-text-[10.5px] tw-text-warning">! moved · no link</span>
        {editLink}
      </span>
    );
  }
  return (
    <span className="tw-flex tw-items-center tw-gap-2">
      <span className="tw-font-mono tw-text-[10.5px] tw-text-error">
        ! rolled back
        {row.reason !== undefined && row.reason.length > 0 ? ` · ${truncate(row.reason, 60)}` : ""}
      </span>
      {editLink}
    </span>
  );
};

const EditSkillMdLink: React.FC<{
  absPath: string;
  onEditSkillMd: (absPath: string) => void;
}> = ({ absPath, onEditSkillMd }) => {
  return (
    <Button
      variant="link"
      size="fit"
      className="tw-h-auto tw-font-mono"
      onClick={(e) => {
        e.stopPropagation();
        onEditSkillMd(absPath);
      }}
    >
      Edit SKILL.md
    </Button>
  );
};

/* --- Pure helpers ---------------------------------------------------- */

/**
 * Bucket bulk-move rows by source agent. Mirrors the consent card's
 * grouping so the results dialog preserves visual continuity.
 */
function groupRowsByAgent(rows: BulkMoveRow[]): Record<BackendId, BulkMoveRow[]> {
  const out: Record<BackendId, BulkMoveRow[]> = {};
  for (const row of rows) {
    const agent = row.candidate.sourceAgent;
    (out[agent] ??= []).push(row);
  }
  return out;
}

/**
 * Build the micro footnote shown beneath the results list. Returns `null`
 * if everything moved cleanly so callers can skip the empty paragraph.
 */
function buildFailureSummary(
  failed: BulkMoveRow[],
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): string | null {
  if (failed.length === 0) return null;
  const n = failed.length;
  const first = failed[0];
  const where = sourceFolderLabel(first.candidate.sourceAgent, agentDirsProjectRel);
  if (n === 1) {
    return `1 skill couldn't be imported. ${first.candidate.name} ${first.reason !== undefined ? `(${first.reason}) ` : ""}— it's still in ${where}${first.candidate.name}/. Fix the issue and run Find existing skills to retry.`;
  }
  return `${n} skills couldn't be imported. Fix the issues and run Find existing skills to retry.`;
}

function sourceFolderLabel(
  agent: BackendId,
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): string {
  return withTrailingSlash(agentDirsProjectRel[agent] ?? "");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
