import {
  Bot,
  ClipboardList,
  FileText,
  FolderTree,
  Globe,
  Hammer,
  ListChecks,
  Pencil,
  Search,
  Terminal,
  Trash2,
  ArrowRightLeft,
  Brain,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon map keyed by `vendorToolName` (richer; Claude Code emits these via
 * `_meta.claudeCode.toolName`) and ACP `toolKind` (portable fallback).
 * Lookup order: vendor → kind → generic. No per-backend overrides — adding
 * an entry here is a UI-layer concern, not a backend boundary leak.
 */
const VENDOR_ICONS: Record<string, LucideIcon> = {
  // Claude Code
  Read: FileText,
  Edit: Pencil,
  MultiEdit: Pencil,
  Write: Pencil,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Bot,
  // Claude Code's Task tool surfaces in `_meta.claudeCode.toolName` as
  // "Agent" (NOT "Task"); the title-only "Task" we put in this map is
  // mostly defensive — both should resolve to the same sub-agent visual.
  Agent: Bot,
  TodoWrite: ListChecks,
  ExitPlanMode: ClipboardList,
  // First-party Obsidian vault MCP tools.
  vault_read: FileText,
  vault_write: Pencil,
  vault_edit: Pencil,
  vault_glob: Search,
  vault_grep: Search,
  vault_list: FolderTree,
};

const KIND_ICONS: Record<string, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: Terminal,
  fetch: Globe,
  switch_mode: ClipboardList,
  think: Brain,
  other: Hammer,
};

export function pickToolIcon(opts: { vendorToolName?: string; toolKind?: string }): LucideIcon {
  if (opts.vendorToolName && VENDOR_ICONS[opts.vendorToolName]) {
    return VENDOR_ICONS[opts.vendorToolName];
  }
  if (opts.toolKind && KIND_ICONS[opts.toolKind]) {
    return KIND_ICONS[opts.toolKind];
  }
  return Hammer;
}
