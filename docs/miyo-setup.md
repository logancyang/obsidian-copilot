# Connect Miyo with Obsidian Copilot

Miyo is the companion app that powers Copilot's search by meaning. It replaces the old index inside the plugin, helping Copilot find relevant notes even when your question uses different words.

This guide connects the Obsidian vault on your computer to Miyo and walks you through your first search.

## Before you start

Use desktop Obsidian with Copilot 4.0.8 or newer. Download Miyo for your operating system from [miyo.md](https://www.miyo.md/) and open it. Use Miyo 0.2.27 or newer if you also want live suggestions while typing in Agent Chat.

Miyo's desktop app and local-agent connection are free. You do not need Relay for this setup. Your chat model or subscription is a separate choice.

## 1. Open Miyo and finish the welcome screens

Click **Get started** when you first open Miyo.

![Miyo welcome screen with Get started](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-welcome-a20177d8edae.png)

On the sources screen, you can choose **Continue** without adding a folder yet. You will register your vault from Copilot in the next step.

![Miyo setup: continue without adding a folder](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-setup-sources-5377d71224c1.png)

The next screen separates on-device connections from remote access. Copilot uses the on-device connection for this guide; you do not need to sign in for Relay. Continue through setup, then return to Obsidian.

![Miyo setup: on-device connections and optional Relay](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-setup-apps-e2a425328204.png)

## 2. Connect your vault

In Obsidian, open **Settings → Copilot → Miyo** and click **Connect**.

If Copilot asks you to register the vault, check that it is the vault you want Miyo to search, then choose **Register & connect**. This adds the vault folder to Miyo and starts indexing its contents.

![Register the current Obsidian vault and connect to Miyo](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-register-vault-75e305c96305.png)

If the vault is already registered, Copilot can connect directly. If it cannot find Miyo, make sure the app is running and try the connection again.

**What to look for:** a connected status in Copilot's Miyo settings. A running Miyo app and a registered vault are both needed.

## 3. Review which notes are included

Open Miyo and find your vault under its local folders. Review the folder's inclusion and exclusion settings, then let the initial scan finish.

To exclude a folder, open its **Folder settings**, choose **Add** under **Indexing → Exclusions**, select **Folder**, and search for the folder name. Select it, then choose **Save** when you want to apply the rule.

<video controls muted loop playsinline preload="metadata" aria-label="Choose a folder to exclude from Miyo indexing" style="width: 100%; height: auto;">
  <source src="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-folder-exclusions-live-8565a84e34cc.mp4" type="video/mp4">
  <a href="https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-folder-exclusions-live-8565a84e34cc.mp4">Watch: Choose a folder to exclude from Miyo indexing</a>
</video>

Miyo controls which files it indexes. If you used Copilot's older search exclusions, review your choices in Miyo rather than assuming those settings carried over. Keep folders you do not want searched excluded.

**What to look for:** your vault is listed and its indexing status has finished. A large vault can take longer on its first scan. Miyo watches registered folders for later changes.

![Miyo shows the indexed vault with Watching status](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-indexed-714dcce29ae0.png)

In this example, the vault has finished scanning and is marked **Watching**.

## 4. Enable semantic search

Return to **Settings → Copilot → Miyo** and turn on **Semantic search**.

This gives your Copilot agents access to Miyo search. Keep **Search scope** on **Current vault** if you only want results from the vault you are using.

![Semantic search switch and Current vault search scope highlighted in Copilot settings](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-semantic-search-highlight-af74bfad26c5.png)

Turn on the highlighted **Semantic search** switch. Keep **Search scope** set to **Current vault**.

## 5. Try a question

Open Agent Chat and ask about an idea you know you have written about. Describe it as you remember it, without copying a note title.

For example, if you have meeting notes, try:

> Use Miyo to find my notes about making meetings more useful. Show me the matching notes before summarizing them.

Read a returned note to check that it fits your question. Explicitly asking for Miyo makes this first test easier to recognize; you can then use it in your normal Copilot workflow.

**You're connected when:** Copilot uses Miyo search and returns a relevant indexed note from your vault.

## What a search can look like

In a recorded example, an agent searched for notes about using several short-lived AI helpers instead of one long conversation. Its keyword search read six files without finding the relevant file. Asked to try Miyo, it found the on-topic file in one search call.

![Agent search comparison: keyword search reads six files without a match; Miyo finds the related note in one search](https://pub-d0d5db63b5e446cc848d32b65229d622.r2.dev/copilot/2026-09/miyo-comparison-d25fc664fc25.png)

The discovered file was a stub, so this example demonstrates finding a file that keyword search missed. It does not measure answer quality or a token-saving percentage.

## If something is missing

| What you see | What to check |
| --- | --- |
| Miyo is not connected | Open Miyo on the same computer, then reconnect from Copilot settings. |
| Your vault is not registered | Register the current vault. A connected service does not mean every vault has been added. |
| A note is still indexing | Let Miyo finish processing it, then try again. |
| A note is excluded | Review its folder rules in Miyo. |
| No relevant result | Confirm the expected note is indexed and contains useful text. Try describing the idea with more context. |
| Registration fails | Review the error and the folders already registered in Miyo, including naming or overlapping-folder conflicts. |

Keep Miyo running while using these features. Local indexing happens on your computer; when you use a cloud chat model, the context sent to that model follows your chat configuration. Relay is a separate remote-access feature.
