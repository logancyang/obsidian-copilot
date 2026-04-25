/**
 * CommentsVaultWatcher - keeps in-memory comment state in sync with vault
 * changes to host notes.
 *
 * Listens for:
 *   - `rename`: re-keys the sidecar index + rewrites the sidecar's notePath
 *   - `delete`: archives the sidecar
 *
 * Sidecar external-edit sync (user hand-edits a JSON) is deferred; it's less
 * important than handling note renames/deletes, and requires content
 * re-merging. Phase E can add if needed.
 */

import { TFile, type App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CommentPersistenceManager } from "./CommentPersistenceManager";
import { commentStore } from "./CommentStore";

export class CommentsVaultWatcher {
  private plugin: CopilotPlugin;
  private persistence: CommentPersistenceManager;

  constructor(plugin: CopilotPlugin, persistence: CommentPersistenceManager) {
    this.plugin = plugin;
    this.persistence = persistence;
  }

  register(): void {
    const app: App = this.plugin.app;
    this.plugin.registerEvent(
      app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const newPath = file.path;
        if (!this.persistence.getStableIdForNotePath(oldPath)) return;
        await this.persistence.renameSidecar(oldPath, newPath);
        const comments = commentStore.getCommentsForNote(oldPath);
        if (comments.length > 0) {
          commentStore.setCommentsForNote(oldPath, []);
          commentStore.setCommentsForNote(newPath, comments);
        }
      })
    );

    this.plugin.registerEvent(
      app.vault.on("delete", async (file) => {
        if (!(file instanceof TFile)) return;
        if (!this.persistence.getStableIdForNotePath(file.path)) return;
        await this.persistence.archiveSidecarForNote(file.path);
        commentStore.setCommentsForNote(file.path, []);
      })
    );
  }
}
