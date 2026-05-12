# Manual Test Plan — Scorecard Warning Fixes (PR #2397)

This PR touches 183 files. Most changes are mechanical, but several intersect runtime behavior. Test in the order below — earlier sections cover higher-risk changes.

Run `npm run build` first, then `obsidian plugin:reload id=copilot`.

---

## 1. File deletion behavior change (HIGH risk)

`vault.delete(file, true)` (force / permanent) was replaced with `FileManager.trashFile()` everywhere except hidden-folder adapter paths. `trashFile` honors the user's "Files and links → Deleted files" setting.

Set **Settings → Files and links → Deleted files = Move to system trash** before testing.

### 1a. Chat history delete

- Send a chat, save it, close the chat tab.
- Open Chat History popover → Delete a saved chat.
- ✅ Notice says "Chat deleted."
- ✅ The `.md` file appears in macOS Trash (not permanently gone).

### 1b. Project delete

- Create a project (`+` in Projects).
- Add a system prompt, save.
- Delete the project from the project list.
- ✅ The `<vault>/copilot-projects/<name>/project.md` file goes to system trash.
- ✅ Empty project folder is also trashed.
- ✅ Other vault files in that folder (if any) are NOT trashed.

### 1c. Project create rollback (failure path — hardest to repro)

- Try to force-fail a project create. Easiest path: create a project, then immediately rename the project folder externally before the frontmatter write completes. If you can't repro the race, skip — it's exercised by 1b implicitly.
- ✅ If rollback fires, partial files end up in trash (not permanently deleted as before — this is the intentional behavior change).

### 1d. Switch trash preference and re-test 1a

- Change to **Move to Obsidian trash (.trash folder)**.
- Repeat 1a → file should appear in `<vault>/.trash/`.
- Change to **Permanently delete**.
- Repeat 1a → file should be gone with no trash entry.

---

## 2. Popout window compatibility (HIGH risk)

`document` → `activeDocument`, `setTimeout` → `window.setTimeout`. Bugs surface when components are mounted in a popout window.

### 2a. Open chat in popout

- Drag the Copilot Chat tab out of the main window into a separate popout.
- Send a message → ✅ streams correctly.
- Type `@` → ✅ note suggestion menu appears inside the popout (not the main window).
- Type `/` → ✅ slash command menu appears inside the popout.
- Paste a long block of text → ✅ paste handling works (PastePlugin).

### 2b. Selection capture across windows

- Open a markdown note in the main window, select text → chat should show selection chip.
- Open a _different_ markdown note in a popout, select text → ✅ selection chip updates.
- Close the popout → ✅ no console error about listeners.

### 2c. Plugin reload while popout open

- With chat open in a popout, run `obsidian plugin:reload id=copilot`.
- ✅ No "Cannot read property of null" or detached-listener errors in console.

### 2d. Modals in popout context

- From inside a popout, open Settings → Add Image modal, Cache Preview, Sources, Add Project, system prompt modals.
- ✅ Each modal renders and is interactive.

---

## 3. Drag and resize (HIGH visual risk)

`element.style.X = Y` was replaced with CSS variables + Tailwind utility classes. Verify nothing snaps to (0,0) or fails to update.

### 3a. QuickAsk overlay

- Trigger QuickAsk (`Cmd+Shift+;` or your binding) in a markdown note.
- ✅ Overlay appears in correct position.
- Drag the overlay header → ✅ moves smoothly with cursor.
- Resize from the corner handle → ✅ resizes smoothly.
- Release in a different position → ✅ stays where dropped.

### 3b. Draggable modal (CustomCommand chat modal / menu command modal)

- Run any custom command that opens a draggable modal.
- ✅ Modal appears centered initially.
- Drag → ✅ follows cursor.
- Resize → ✅ resizes smoothly.

### 3c. Typeahead menu positioning

- In chat input, type `@` near the bottom of the chat panel.
- ✅ Menu opens above the caret without being clipped.
- Type `/` at the top → ✅ menu opens below the caret.

### 3d. Inline pills (note/folder/URL/active note/web tab)

- Type `@` and select a note → ✅ note pill inserts with proper styling.
- Repeat for folder, URL, active note, web tab.
- ✅ All pills render with correct icon, padding, hover state.

---

## 4. Brevilabs multipart upload (HIGH risk)

`brevilabsClient` switched from native `fetch(formData)` to manually-built multipart body via Obsidian's `requestUrl`. Affects all file uploads to the Brevilabs API.

Requires a valid Plus license. Skip section if not available.

### 4a. Image upload

- In chat, attach an image (PNG, JPEG).
- Send a message asking about the image.
- ✅ Model receives the image and responds about its content.

### 4b. PDF upload

- Attach a PDF (small, multi-page).
- Ask about its content.
- ✅ Response references the PDF text.

### 4c. Audio transcription (if exposed)

- If you have a voice note feature exposed, upload audio.
- ✅ Transcription returns.

### 4d. Error path

- Disconnect from internet, send a message with attachment.
- ✅ Error toast surfaces a meaningful message (not a JSON parse error).

---

## 5. Bedrock provider (MEDIUM risk)

`_getType()` → `getType()` on LangChain messages, and `atob`-fallback removed in favor of `Buffer.from`. Only matters if user has AWS Bedrock configured.

### 5a. Bedrock chat (text)

- Set active model to a Bedrock Claude (e.g. `global.anthropic.claude-sonnet-4-5-...`).
- Send a chat message.
- ✅ Streams correctly. Multi-turn conversation history works.

### 5b. Bedrock with system prompt

- Configure a project with a system prompt, switch to Bedrock model.
- ✅ System prompt is honored.

### 5c. Bedrock tool calling (Copilot Plus mode)

- In Copilot Plus mode with Bedrock active, ask a question that triggers tools (e.g. "summarize my note about X").
- ✅ Tool calls execute and stream results.

### 5d. Bedrock image input

- Attach an image, send to Bedrock.
- ✅ Image is decoded and sent (this exercises `decodeBase64ToUint8Array`).

---

## 6. Synthetic TFile / hidden folder projects (MEDIUM risk)

`createSyntheticTFile` now uses `Object.create(TFile.prototype)`, so synthetic files pass `instanceof TFile`. Also `resolveFileByPath` now skips folders (previously cast them to TFile).

### 6a. Project stored in hidden folder

- If you have a project under a hidden folder (e.g. `.copilot-projects/`), open it.
- ✅ Project loads, system prompt applies, chat works.
- Edit the project's system prompt and save.
- ✅ Change persists; no errors about frontmatter processing.

### 6b. Folder path passed to resolveFileByPath

- Hard to repro directly. Verified by 6a — if project lookups succeed, the function works.

---

## 7. Selection highlight controller (LOW — just fixed)

The `persistFromPointerDown` guard now uses `getActiveViewOfType(MarkdownView)` instead of comparing leaf types.

### 7a. Click into chat from markdown

- Open a markdown note, select some text.
- Click into the chat input.
- ✅ Selected text is captured as a chat context chip.

### 7b. Click into chat with no markdown view active

- Close all markdown tabs (only chat open).
- Click chat input.
- ✅ No errors. No selection captured (expected).

---

## 8. Selection change listener (LOW — just fixed)

`selectionchange` listener is now registered against the captured document at registration time (not `activeDocument` at removal time).

### 8a. Open chat in popout, then disable plugin

- Open chat in popout (section 2a).
- Disable the plugin via Settings → Community plugins.
- ✅ No console error about `removeEventListener` failing.
- Re-enable the plugin.
- ✅ Selection capture in the popout still works (if popout was re-used).

---

## 9. Base64 / binary correctness (LOW — sanity check)

`atob`/`btoa` replaced with `Buffer`. Affects `arrayBufferToBase64` and `base64ToArrayBuffer` (used by encryption service and embeddings cache).

### 9a. Encrypt API keys

- In Settings → Advanced → toggle "Enable encryption" on.
- Save and reload.
- ✅ Saved keys still load correctly (decrypt round-trip).
- Toggle off, save, reload.
- ✅ Keys still load.

### 9b. Embedding cache

- Run "Refresh Vault Index" (Copilot menu).
- ✅ Indexing completes without errors.
- Restart Obsidian.
- ✅ Cached embeddings reload (no full re-index).

---

## 10. General smoke tests (must-pass)

### 10a. Custom commands

- Open Settings → Custom Commands.
- ✅ Existing commands list correctly.
- Edit a command, save, run it from the command palette.
- ✅ Runs without error.

### 10b. System prompts

- Open Settings → System Prompts.
- ✅ List loads.
- Create a new system prompt, attach to a project.
- ✅ Project chat uses the new prompt.

### 10c. Model add/edit

- Settings → Models → Add a new custom model.
- ✅ Form works, can save.
- Edit a model, change parameters.
- ✅ Updates persist; new chat uses updated parameters.

### 10d. Chain types

- Switch between Chat, Vault QA, Copilot Plus, Project chains.
- Send a message in each.
- ✅ All four respond correctly.

### 10e. Lint and tests

- `npm run lint` → ✅ exits 0.
- `npm run test` → ✅ all unit tests pass.

---

## Known intentional behavior changes (not bugs)

These are by-design changes — don't flag as regressions:

- **Project rollback artifacts go to trash** (section 1c) — previously force-deleted. Intentionally aligned with user's trash preference.
- **Hidden-folder files via `resolveFileByPath`** now pass `instanceof TFile` (synthetic prototype). Previously they were a cast that lied about identity.
- **`getActiveViewOfType(MarkdownView)` replaces `activeLeaf` comparison** in `persistFromPointerDown` — the new check is the equivalent intent, but expressed correctly.

---

## Failure triage

If a section fails:

1. Check the browser console (`Cmd+Opt+I`) for the error.
2. Run `obsidian dev:console level=error limit=20` for recent errors.
3. Look up the file in the PR diff: `gh pr diff 2397 -- <file>`.
4. The most behaviorally significant changes are in:
   - `src/projects/ProjectFileManager.ts` / `projectMigration.ts` (trashFile, App refactor)
   - `src/LLMProviders/brevilabsClient.ts` (multipart rewrite)
   - `src/LLMProviders/BedrockChatModel.ts` (getType, base64)
   - `src/utils/vaultAdapterUtils.ts` (synthetic TFile, trashFile helper)
   - `src/hooks/use-draggable.ts` / `use-resizable.ts` (CSS-var refactor)
   - `src/main.ts` (selection handler refactor, just fixed)
   - `src/editor/chatSelectionHighlightController.ts` (guard refactor, just fixed)
