# Create agent dialog

The `New agent` dialog that makes a custom agent: its name, optional title, and what it handles.

## Sub-features

- create-fields: `Name`, `Title` (optional), and the instruction field. The instruction field's label follows the name as it is typed: "What it handles", then "What Kai handles"; its grey example text disappears once the user types.
- create-saved-in: the bottom left reads `Saved in <Copilot folder>/agents/<name>/`, following the name as it is typed.
- create-instruction-count: once the instruction has text, a count such as `372 / 4,000` shows under it; past 4,000 characters it turns orange, and Create still works.
- create-missing-instruction: leaving the instruction empty shows "Write at least one sentence. Without it, Kai is just Copilot with a face." Create stays unavailable, and hovering it says what is missing: "Give it a name first" or "Write what Kai handles first".
- create-name-in-use: a name already on the team, in any case, shows "Leo is already on your team. Pick another name." and Create stays unavailable.
- create-folder-in-use: a name whose folder another agent already uses, such as `Coco` after Coco was renamed to Chief or `maya-chen` next to Maya Chen, shows "Chief already uses the folder coco. Pick another name."; a folder of that name holding no agent shows "A folder named kai already exists in your agents folder. Pick another name." Create stays unavailable either way.
- create-long-name: a name over 12 characters shows "Long names get cut off in tabs." Names have no length limit.
- create-close: with nothing typed, Esc, the close button, `Cancel`, or a click outside closes the dialog. With text typed, a click outside does nothing, and Esc, the close button, or `Cancel` ask "Discard Kai?" with `Keep editing` and `Discard`.
- create-agent: `Create` writes the agent's folder with its instructions on the default model, and no memory file; the agent shows the placeholder face. The dialog closes and the [start screen](agent-home.md) shows the new agent selected, with the cursor in the chat input.
- create-failed: when the agent cannot be written, the dialog stays open with everything typed and says why: "Couldn't create Kai. …"

## How to get to it

- **New** (**+**) in the row of faces on the [start screen](agent-home.md), and on a [project](projects.md)'s start screen.

It needs a license that includes custom agents (a team license until launch).

## Driving it

- Fields: open the dialog and type a name. The instruction label, its hint, and `Saved in` follow the name.
- Count: paste more than 4,000 characters into the instruction. The count turns orange and Create still works.
- Missing instruction: type a name, click into the instruction, and click out. The red note shows; hover Create for "Write what <name> handles first".
- Name in use: type an existing agent's name in lowercase. The red note names the agent and Create is unavailable.
- Folder in use: rename Coco to Chief on its [profile](agent-profile.md), then type `Coco` in the dialog. The red note says Chief already uses the folder coco, and Create is unavailable.
- Long name: type a 13-character name. "Long names get cut off in tabs." shows under it.
- Close: with nothing typed, click outside: the dialog closes. Type a name, click outside: nothing happens. Press Esc: "Discard <name>?" shows; Esc again or `Keep editing` returns to the form; `Discard` closes it.
- Create: fill a name and instruction and choose `Create`. The start screen shows the agent selected and "Ask <name> anything"; the agent's folder holds its instructions and no memory file. The first message starts a chat that follows the instruction.
- Failed: lose the license while the dialog is open and choose `Create`. The dialog stays open with the text and shows why.

## Gotchas

- An agent's folder is named after its name and keeps that name through a rename. Agents in numbered folders such as `kai-2`, or two agents with the same name in hand-made folders, still show as separate agents.
