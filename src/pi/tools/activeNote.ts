import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { PiNote, PiToolContext } from "./index";
import { textResult } from "./toolResult";

const ACTIVE_NOTE_PARAMS = Type.Object({});

/**
 * Reads the note the user currently has open. The model cannot see the
 * workspace, so without this it has no way to answer "summarize this note".
 */
export const activeNoteTool: AgentHarnessTool<PiToolContext, typeof ACTIVE_NOTE_PARAMS> = {
  name: "read_active_note",
  label: "Read active note",
  description:
    "Read the note the user currently has open in Obsidian. Use this whenever the user says 'this note', 'the current note', or asks about what they are looking at.",
  parameters: ACTIVE_NOTE_PARAMS,
  execute: async (_toolCallId, _params, _signal, _onUpdate, context) => {
    const note: PiNote | null = await context.readActiveNote();
    if (!note) return textResult("No note is currently open.", { path: null });
    return textResult(`# ${note.path}\n\n${note.content}`, { path: note.path });
  },
};
