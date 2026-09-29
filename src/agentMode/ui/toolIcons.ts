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
  Sparkles,
  Terminal,
  Trash2,
  ArrowRightLeft,
  Brain,
  type LucideIcon,
} from "lucide-react";

const VENDOR_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Edit: Pencil,
  MultiEdit: Pencil,
  Write: Pencil,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  LS: FolderTree,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Bot,
  Agent: Bot,
  TodoWrite: ListChecks,
  ExitPlanMode: ClipboardList,
  Skill: Sparkles,
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
