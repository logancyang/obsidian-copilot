import React from "react";

export function CustomPromptSyntaxInstruction() {
  return (
    <ul className="text-sm px-4 m-0">
      <li>
        <span className="font-medium text-accent">{"{}"}</span> represents the selected text.
      </li>
      <li>
        <span className="font-medium text-accent">{`{[[Note Title]]}`}</span> represents a note.
      </li>
      <li>
        <span className="font-medium text-accent">{`{activeNote}`}</span> represents the active
        note.
      </li>
      <li>
        <span className="font-medium text-accent">{`{#tag1, #tag2}`}</span> represents ALL notes
        with ANY of the specified tags in their property (an OR operation).
      </li>
    </ul>
  );
}
