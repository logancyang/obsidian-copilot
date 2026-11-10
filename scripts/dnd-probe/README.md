# Drag-and-drop probe

Logs what a cross-app drag (for example a PDF dragged out of WeChat) carries on macOS and what each Obsidian drop target receives, so a drop that works in the file navigator can be compared with one that fails in Copilot chat.

## 1. Watch the macOS drag pasteboard

```bash
cd scripts/dnd-probe
swiftc -O pbwatch.swift -o pbwatch
./pbwatch | tee ~/dnd-probe/drag-pb.log
```

Every new drag prints each pasteboard item with all of its types and values (file URLs, plain text, file-promise metadata). Leave it running.

## 2. Log drops inside Obsidian

Open Obsidian's developer console (`Cmd+Option+I`) in the vault you are testing, paste the contents of `probe-renderer.js`, and press Enter. Or, with the Obsidian CLI:

```bash
obsidian vault=<vault name> eval code="$(cat scripts/dnd-probe/probe-renderer.js)"
```

A panel at the top right shows each drag event live. Every event is also appended to `~/dnd-probe/drop-renderer.log` and kept in `window.__dndProbeLog`. Each record has:

- `zone`: `navigator`, `copilot-chat`, `editor`, or `other:<class>`
- `types` and `items` of the drag
- on `drop`: `files` (name, MIME type, size, disk path) and `strings` (the value of every text type)
- a `bubble@window` record when the drop event propagated past every handler; no such record means a handler called `stopPropagation()`

Run `window.__probeOff()` to remove the listeners and the panel.

## 3. Test

1. Drag the PDF from WeChat onto the file navigator.
2. Drag the same PDF onto the Copilot chat input.
3. Share `~/dnd-probe/drag-pb.log` and `~/dnd-probe/drop-renderer.log`, or run `copy(JSON.stringify(window.__dndProbeLog))` in the console and paste the result.
