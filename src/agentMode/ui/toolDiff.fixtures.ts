const oldText = Array.from(
  { length: 200 },
  (_, index) => `Line ${index + 1}: Keep the review readable.`
).join("\n");

export const MULTI_HUNK_DIFF = {
  type: "diff" as const,
  path: "Projects/Launch planning/Review notes.md",
  oldText,
  newText: oldText
    .replace("Line 20: Keep", "Line 20: Make")
    .replace("Line 170: Keep", "Line 170: Make"),
};

export const WHITESPACE_DIFF = {
  type: "diff" as const,
  path: "Markdown structure.md",
  oldText: "First line\nSecond line\n\n- Parent item\n- Nested item\n\nCode\n",
  newText: "First line  \nSecond line\n\n- Parent item\n  - Nested item\n\n\tCode\n",
};

export const NEW_NOTE_DIFF = {
  type: "diff" as const,
  path: "New note.md",
  oldText: null,
  newText: Array.from({ length: 30 }, (_, index) => `New note line ${index + 1}`).join("\n"),
};
