# Use Live Relevant Notes in Copilot

Relevant Notes brings related notes into view while you work. You can read a suggestion, link it into your writing, or add it to a chat before asking your question.

This guide covers two workflows: discovering connections while writing a note, and finding useful context while composing a chat message.

## Before you start

Use desktop Copilot 4.0.8 or newer with Miyo 0.2.27 or newer, running and connected to your indexed vault. If you have not connected it yet, follow [Connect Miyo with Obsidian Copilot](miyo-setup.md).

## 1. Open Relevant Notes

Open Copilot's Agent Chat view and choose **Relevant Notes**. Use **Open in separate pane** if you want to keep the suggestions visible beside your editor or chat.

Turn on **Live**. The source label tells you what the suggestions relate to, such as the open note or the Agent Chat context.

## 2. Discover related notes while writing

Open a note with some text and begin writing. As the subject develops, Relevant Notes can bring different notes into view.

In this demo, a weekend plan starts with hiking, then shifts toward visiting Hong Kong. The suggestions change along with the writing.

<video controls muted loop playsinline preload="metadata" aria-label="Relevant Notes changes as the note shifts from hiking to a Hong Kong visit" style="width: 100%; height: auto;">
  <source src="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/live-relevant-editor-clean-62eb5ce757a0.mp4" type="video/mp4">
  <a href="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/live-relevant-editor-clean-62eb5ce757a0.mp4">Watch: Relevant Notes changes as the note shifts from hiking to a Hong Kong visit</a>
</video>

Hover over a suggested title to preview the note. Click **Open note** when you want to read it in full.

The percentage beside a suggestion describes its similarity to the source context. Use the preview to decide whether it is useful; the number is not a measure of factual accuracy.

## 3. Link a suggestion into your note

Keep the note you are writing open in an editable view. Drag a suggested note's title from Relevant Notes to the place in your editor where you want the reference.

Obsidian inserts a link to that note. This adds a reference, not a copy of its contents.

**What to look for:** the linked note title appears at the drop position in your writing.

<video controls muted loop playsinline preload="metadata" aria-label="Drag Daily Notes Best Practices into the editor to insert a note link" style="width: 100%; height: auto;">
  <source src="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/relevant-notes-drag-to-note-d16596640a03.mp4" type="video/mp4">
  <a href="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/relevant-notes-drag-to-note-d16596640a03.mp4">Watch: Drag Daily Notes Best Practices into the editor to insert a note link</a>
</video>

## 4. Find context before sending a question

With Live on, start typing in Agent Chat. Suggestions follow your draft and conversation, so you can discover useful context before sending the message.

Try a question related to material in your vault. The demo uses:

> Help me plan our next team workshop.

Hover over a useful suggestion and choose **Add to Chat**. Check that the note appears in your chat context, then make your question more specific using what you found.

<video controls muted loop playsinline preload="metadata" aria-label="Preview a related note and add it to Agent Chat while drafting a question" style="width: 100%; height: auto;">
  <source src="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/live-relevant-notes-clean-35f7a92dda84.mp4" type="video/mp4">
  <a href="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/live-relevant-notes-clean-35f7a92dda84.mp4">Watch: Preview a related note and add it to Agent Chat while drafting a question</a>
</video>

For example, a note about silent writing might remind you to ask for a workshop that starts with five minutes of individual thinking.

Suggested notes are not all attached automatically. You choose which ones to add before sending.

## Which context is being used?

When chat-based Live suggestions are active, they follow your Agent Chat draft and conversation. When Live is off, Relevant Notes stays tied to the editor note.

If suggestions seem unrelated to what you intended, check the source label first. Then check that the note or chat you want to work with is active.

## If suggestions do not appear

| Message or symptom | What to do |
| --- | --- |
| Miyo is not connected | Start Miyo and reconnect in Copilot settings. |
| This vault is not registered | Add this vault to Miyo. |
| Still indexing or note not indexed | Let indexing finish and review the note's status in Miyo. |
| This note is excluded | Check Miyo's folder rules. |
| No semantic matches yet | Try a note with more useful text or a more specific question. A connected index may have no related material. |
| No usable chat context | Write a message or add an indexed note. |
| Editor suggestions work, but chat suggestions do not | Check Copilot and Miyo versions and turn on Live. Chat suggestions require Miyo 0.2.27 support. |

[Watch the full Relevant Notes demo →](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/releases/4.0.8/relevant-notes-demo-20260910.mp4)
