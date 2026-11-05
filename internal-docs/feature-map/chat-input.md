# Chat input

The box at the bottom of Agent Chat where the user writes and sends a message: model, effort, and mode pickers, mentions, note context, images, send, and stop.

## Sub-features

- input-send: type a message and press Enter or `Send`.
- input-stop: `Stop generating` or Escape stops the agent's reply.
- input-mentions: `@` or `Add context` adds Notes, Folders, Web tabs, or Images; with multi-agent access, Agents asks other agents the same message.
- input-current-note: the open note or web tab shows as a `Current` badge that the user can remove.
- input-selection: text selected in a note or a [turn diff](turn-diffs.md) shows as a `Selection` badge.
- input-images: paste or drop images to attach them; `Remove image` takes one off. Notes dropped onto Agent Chat are added as context.
- input-commands: `/` lists `/compact`, the agent's skills, and custom commands.
- input-model-effort: `Model · effort` picks the model, including other agents' models, and its effort.
- input-mode: `Mode` picks `Auto`, `Plan`, or `Safe`; Shift+Tab cycles through them.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
