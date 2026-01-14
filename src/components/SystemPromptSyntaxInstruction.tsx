import React from "react";

/**
 * SystemPromptSyntaxInstruction component displays available template variables for system prompts.
 * Note: Unlike custom commands, system prompts do NOT support {} for selected text.
 */
export function SystemPromptSyntaxInstruction() {
  return (
    <ul className="tw-m-0 tw-px-4 tw-text-sm">
      <li>
        <span className="tw-font-medium tw-text-accent">{`{activeNote}`}</span> represents the
        active note.
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{[[Note Title]]}`}</span> represents a
        note.
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{#tag1, #tag2}`}</span> represents ALL
        notes with ANY of the specified tags in their property (an OR operation).
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{folder/path}`}</span> represents notes
        from a specific folder path.
      </li>
    </ul>
  );
}
