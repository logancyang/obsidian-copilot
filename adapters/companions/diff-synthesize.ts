export type AcpDiffDetail = {
  old_string: string;
  new_string: string;
  old_line?: number;
  new_line?: number;
  context_before?: string;
  context_after?: string;
  line_prefix?: string;
};
export type AcpDiffBlock = {
  type: "diff";
  path: string;
  oldText: string;
  newText: string;
  _meta?: {
    old_line?: number;
    new_line?: number;
    details?: AcpDiffDetail[];
  };
};
export type SynthesizeEditDiffInput = {
  path: string;
  oldText: string;
  newText: string;
  oldLine?: number;
  newLine?: number;
  replaceAll?: boolean;
  details?: Array<{
    old_string: string;
    new_string: string;
    old_line?: number;
    new_line?: number;
  }>;
};
export function synthesizeEditDiff(input: SynthesizeEditDiffInput): AcpDiffBlock | undefined {
  const path = (input.path || "").trim();
  if (!path) return undefined;
  const oldText = input.oldText ?? "";
  const newText = input.newText ?? "";
  const details = (input.details ?? [])
    .filter((d) => typeof d.old_string === "string" || typeof d.new_string === "string")
    .map((d) => ({
      old_string: d.old_string ?? "",
      new_string: d.new_string ?? "",
      ...(d.old_line !== undefined ? { old_line: d.old_line } : {}),
      ...(d.new_line !== undefined ? { new_line: d.new_line } : {}),
    }));
  const meta: AcpDiffBlock["_meta"] = {};
  if (input.oldLine !== undefined) meta.old_line = input.oldLine;
  if (input.newLine !== undefined) meta.new_line = input.newLine;
  if (details.length) meta.details = details;
  return {
    type: "diff",
    path,
    oldText,
    newText,
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
  };
}
function isDiffBlock(block: unknown): block is AcpDiffBlock {
  return !!block && typeof block === "object" && "type" in block && block.type === "diff";
}
function isUsefulDiffBlock(block: AcpDiffBlock): boolean {
  if (block.oldText !== block.newText) return true;
  const details = block._meta?.details;
  return Array.isArray(details) && details.some((d) => d && d.old_string !== d.new_string);
}
function findDiffIndexForPath(content: unknown[], path: string): number {
  return content.findIndex((block) => isDiffBlock(block) && block.path === path);
}
export function mergeDiffIntoContent(content: unknown, diff: AcpDiffBlock | undefined): unknown[] {
  const existing = Array.isArray(content)
    ? content
    : content === undefined || content === null
      ? []
      : [content];
  if (!diff) return existing;
  const at = findDiffIndexForPath(existing, diff.path);
  if (at === -1) return [...existing, diff];
  if (isUsefulDiffBlock(existing[at] as AcpDiffBlock)) return existing;
  const next = [...existing];
  next[at] = diff;
  return next;
}
export function contentHasDiff(content: unknown, path?: string): boolean {
  if (!Array.isArray(content)) return false;
  if (path === undefined) {
    return content.some((block) => isDiffBlock(block) && isUsefulDiffBlock(block));
  }
  const at = findDiffIndexForPath(content, path);
  return at !== -1 && isUsefulDiffBlock(content[at] as AcpDiffBlock);
}
