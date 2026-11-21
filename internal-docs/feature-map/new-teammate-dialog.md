# New teammate dialog

The `New teammate` dialog that makes a teammate: its face, name, optional title, what it handles, and its model.

## Sub-features

- create-first-agent: in a vault with no teammates, the dialog opens filled in as a chief of staff for the whole vault: `Coco`, "Chief of staff. Knows the whole vault.", and a four-paragraph instruction that ends by suggesting a new teammate when the same kind of work keeps coming back. Every field can be changed and `Create` works at once. Closing it untouched just closes; once a field is changed, closing asks "Discard Coco?". Once the vault has a teammate, the dialog opens empty.
- create-ask-copilot: opened with **New**, the dialog starts with "Tip: you can also just ask. Tell Copilot what you need and it drafts the teammate for you." and `Ask Copilot`. `Ask Copilot` closes the dialog the way closing does (asking "Discard Kai?" once something is typed), puts the new chat on Copilot, and fills its chat input with one sentence, without sending it: "Create a new teammate named Kai for me. Here's what it should do: " with the typed name, or "Create a new teammate for me and suggest a name for it. Here's what it should do: " with none, followed by the instruction the user typed. The cursor sits at the end, so the user only describes the teammate. The tip does not show when the dialog opens from a draft card.
- create-fields: `Name` (example text `e.g. Leo`), `Title` (optional), the instruction field, and `Model`. The instruction field's label, its hint ("Kai reads this at the start of every chat."), and `Saved in` show the name once the `Name` field is left: "What it handles" while the name is typed, then "What Kai handles". The name in use note and Create follow every key. The instruction's grey example text disappears once the user types.
- create-face: the dialog opens wearing a preset face no other teammate wears. The face at the top left opens `Pick a face`: a grid of preset faces, with the ones already on the team faded ("Faded faces are already on your team.") but still choosable, and `Upload image` for a png, jpg, or webp file. A file that is not a readable image keeps the face as it was and shows "Couldn't read that image. Choose a PNG, JPEG or WebP file."
- create-face-loading: while the preset faces download, `Pick a face` shows twelve round placeholders where the faces go, with a soft highlight sweeping across them; the faces take their places when they arrive.
- create-face-offline: when the preset faces cannot load, the dialog opens with a blank face and `Pick a face` says "Couldn't load the preset faces. You can upload an image."; `Upload image` still works.
- create-model: `Model` lists the models a chat can run on, grouped by agent, with the effort slider; it starts on the default model and the effort a chat would use with it.
- create-saved-in: the bottom left reads `Saved in <Copilot folder>/teammates/<name>/` for the name as of when the `Name` field was last left.
- create-instruction-count: once the instruction has text, a count such as `372 / 4,000` shows under it; past 4,000 characters it turns orange, and Create still works.
- create-missing-instruction: leaving the instruction empty shows "Write at least one sentence. Without it, Kai is just Copilot with a face." Create stays unavailable, and hovering it says what is missing: "Give it a name first" or "Write what Kai handles first".
- create-name-in-use: a name already on the team, in any case, shows "Leo is already on your team. Pick another name." and Create stays unavailable.
- create-folder-in-use: a name whose folder another teammate already uses, such as `Coco` after Coco was renamed to Chief or `maya-chen` next to Maya Chen, shows "Chief already uses the folder coco. Pick another name."; a folder of that name holding no teammate shows "A folder named kai already exists in your teammates folder. Pick another name." Create stays unavailable either way.
- create-long-name: a name over 12 characters shows "Long names get cut off in tabs." Names have no length limit.
- create-close: with nothing typed, or nothing changed in a dialog that opened filled in, Esc, the close button, `Cancel`, or a click outside closes the dialog. With text typed, a click outside does nothing, and Esc, the close button, or `Cancel` ask "Discard Kai?" with `Keep editing` and `Discard`.
- create-agent: `Create` writes the teammate's folder with its instructions and face, and no memory file. The dialog closes and the [start screen](start-screen.md) shows the new teammate selected, with the cursor in the chat input.
- create-failed: when the teammate cannot be written, the dialog stays open with everything typed and says why: "Couldn't create Kai. …"
- create-drafted: opened from a `New teammate draft` card, the dialog is filled with the draft's name, title, and instruction, under a first line with the drafting teammate's face: "Drafted by Coco. Check it, pick a face and a model, then create." From a Copilot chat's card the first line is left out. Everything else works as for **New**: a drafted name already on the team, an empty instruction, or one past 4,000 characters gets the usual notes. After `Create`, the start screen opens with the new teammate selected and the cursor in the chat input.

## How to get to it

- **New** (**+**) in the row of faces on the [start screen](start-screen.md), and on a [project](projects.md)'s start screen.
- `Review and create…` on a `New teammate draft` card in a teammate's chat or a Copilot chat ([replies](replies.md)).

It needs a Supporter license; without one, `New` opens the Supporter preview instead.

## Driving it

- First teammate: in a vault with no teammates, choose **New**. The dialog shows Coco filled in with a face and the default model; press Esc: it closes without asking. Choose **New**, then `Create` without typing. The start screen shows Coco selected, and its `instructions.md` holds that name, title, and instruction. Choose **New** again: the dialog is empty. Delete Coco and choose **New**: Coco is filled in again.
- Ask Copilot: choose **New**, type a name, choose `Ask Copilot` and then `Discard`. The new chat is on Copilot and its input reads "Create a new teammate named <name> for me. Here's what it should do: " with the cursor at the end. Type the job and send it: a draft card shows, and `Review and create…` opens the dialog filled in without the tip.
- Fields: open the dialog and type a name. The instruction label, its hint, and `Saved in` stay as they were; click into `Title`: all three show the name.
- Face: open the dialog. A face shows that no teammate wears. Choose it: `Pick a face` shows the grid with team faces faded. Choose another face, or `Upload image` and pick a photo. It shows as the face; after Create, the teammate's face file is the preset, or the photo cut to a 256 by 256 square.
- Faces loading: on a slow connection, open the dialog and choose the face at once. Twelve shimmering placeholders fill the grid, then the faces appear in the same places without the picker changing size.
- Faces offline: open the dialog without internet. The face is blank, `Pick a face` says the preset faces couldn't load, and `Upload image` works.
- Model: open `Model`, pick another model and effort, and create. The new teammate's chat starts on that model.
- Count: paste more than 4,000 characters into the instruction. The count turns orange and Create still works.
- Missing instruction: type a name, click into the instruction, and click out. The red note shows; hover Create for "Write what <name> handles first".
- Name in use: type an existing teammate's name in lowercase. The red note names the teammate and Create is unavailable.
- Folder in use: rename Coco to Chief on its [profile](teammate-profile.md), then type `Coco` in the dialog. The red note says Chief already uses the folder coco, and Create is unavailable.
- Long name: type a 13-character name. "Long names get cut off in tabs." shows under it.
- Close: with nothing typed, click outside: the dialog closes. Type a name, click outside: nothing happens. Press Esc: "Discard <name>?" shows; Esc again or `Keep editing` returns to the form; `Discard` closes it.
- Create: fill a name and instruction and choose `Create`. The start screen shows the teammate selected and "Ask <name> anything"; the teammate's folder holds its instructions and face and no memory file. The first message starts a chat that follows the instruction.
- Failed: with the dialog open, clear the license key so there is no valid license, then choose `Create`. The dialog stays open with the text and shows why.
- Drafted: in Coco's chat, ask for a family logistics teammate and choose `Review and create…` on the card. The dialog opens filled in with "Drafted by Coco." and Coco's face at the top. Change the title, pick a face and a model, and choose `Create`: the start screen shows the new teammate selected with the cursor in the chat input, and its `instructions.md` holds the instruction as approved.

## Gotchas

- The preset faces download from the Brevilabs CDN when the dialog opens. A chosen preset is saved into the teammate's folder, so showing the teammate never needs the internet.
- A teammate's folder is named after its name and keeps that name through a rename. Teammates in numbered folders such as `kai-2`, or two teammates with the same name in hand-made folders, still show as separate teammates.
- Esc first closes an open face or model picker; the next Esc acts on the dialog.
