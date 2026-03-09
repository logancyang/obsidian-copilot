/**
 * Shared preprocessing utilities for AI response markdown rendering.
 * Used by both ChatSingleMessage (Chat Panel) and QuickAskMessage (Quick Ask)
 * to ensure consistent rendering behavior across all AI response surfaces.
 */

/**
 * Normalizes LaTeX delimiters to Obsidian-compatible format.
 * Converts `\[...\]` to `$$...$$` (display math) and `\(...\)` to `$...$` (inline math).
 *
 * Reason: LLMs typically output LaTeX using `\[` / `\(` delimiters,
 * but Obsidian's MarkdownRenderer only recognizes `$` / `$$` delimiters.
 */
export function normalizeLatexDelimiters(content: string): string {
  // Reason: Split on fenced code blocks and inline code so we never
  // rewrite LaTeX-like delimiters inside code spans/blocks.
  const parts = content.split(/(```[\s\S]*?```|`[^`]*`)/g);

  return parts
    .map((part, index) => {
      // Odd indices are code segments captured by the regex — leave them untouched
      if (index % 2 === 1) return part;

      return part
        .replace(/\\\[\s*/g, "$$")
        .replace(/\s*\\\]/g, "$$")
        .replace(/\\\(\s*/g, "$")
        .replace(/\s*\\\)/g, "$");
    })
    .join("");
}

/**
 * Escapes dataview code blocks to prevent execution in AI responses.
 * Converts ```dataview to ```text and ```dataviewjs to ```javascript
 * so they display as static code examples instead of executing queries.
 */
export function escapeDataviewCodeBlocks(text: string): string {
  text = text.replace(/```dataview(\s*(?:\n|$))/g, "```text$1");
  text = text.replace(/```dataviewjs(\s*(?:\n|$))/g, "```javascript$1");
  return text;
}

/**
 * Escapes tasks code blocks to prevent execution in AI responses.
 * Converts ```tasks to ```text so they display as static code examples
 * instead of executing task queries.
 */
export function escapeTasksCodeBlocks(text: string): string {
  return text.replace(/```tasks(\s*(?:\n|$))/g, "```text$1");
}

/**
 * Applies shared safety and math preprocessing for AI response content
 * before passing to Obsidian's MarkdownRenderer.
 *
 * Covers: executable code block escaping (dataview/tasks) and LaTeX
 * delimiter normalization. Chat Panel applies additional context-specific
 * processing (think sections, citations, note links, etc.) on top of this.
 */
export function preprocessAIResponse(content: string): string {
  const dataviewEscaped = escapeDataviewCodeBlocks(content);
  const tasksEscaped = escapeTasksCodeBlocks(dataviewEscaped);
  return normalizeLatexDelimiters(tasksEscaped);
}
