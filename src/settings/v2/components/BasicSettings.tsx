import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, SEND_SHORTCUT } from "@/constants";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { cn } from "@/lib/utils";
import { verifyMiyoScope } from "@/miyo/miyoResync";
import { shouldSurfaceMiyoResync } from "@/miyo/miyoUtils";
import { openAgentsFile, writeAgentsFile } from "@/instructions/agentsFile";
import { useAgentsFileDraft } from "@/instructions/useAgentsFileDraft";
import { logError } from "@/logger";
import { debounce } from "@/utils/debounce";
import { ensureCopilotSubfolders } from "@/settings/copilotFolder";
import {
  applyCopilotRootChange,
  copilotRootContainsNotes,
  findCopilotRootFileConflict,
} from "@/settings/copilotRootChange";
import {
  getSettings,
  updateSetting,
  useSettingsValue,
  validateCopilotFolder,
} from "@/settings/model";
import { DesktopOnlySettingsPanel } from "@/settings/v2/components/DesktopOnlySettingsPanel";
import { CopilotFolderChangeNotice } from "@/settings/v2/components/CopilotFolderChangeNotice";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { PlusSettings } from "@/settings/v2/components/PlusSettings";
import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { formatDateTime } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Folder, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const LazyAgentSettings = React.lazy(() =>
  import("@/settings/v2/components/AgentSettings").then((module) => ({
    default: module.AgentSettings,
  }))
);

/**
 * The Agents block of the Basic tab, behind the desktop gate. `React.lazy`
 * defers the import until this actually renders, so the desktop check runs
 * before the `@/agentMode` barrel — which pulls in Node-only modules that throw
 * on evaluation under a mobile runtime — is ever requested.
 */
const AgentsSection: React.FC = () => {
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message="Agent settings are available on desktop." />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazyAgentSettings />
    </React.Suspense>
  );
};

export const BasicSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  // From the plugin, not captured here: this tab mounts the first time the user
  // selects it, so a tab first opened after a reload would vouch for the
  // incoming lifecycle while still holding the outgoing vault's `app`.
  const { miyoMutationSession } = usePlugin();
  const [isChecking, setIsChecking] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

  // Draft + explicit Apply for the Copilot root. Reason: persisting on every
  // keystroke would re-point every derived sub-folder and trigger reload
  // watchers per character; a root change also needs an up-front confirmation.
  const persistedRoot = settings.copilotFolder;
  const [folderDraft, setFolderDraft] = useState(persistedRoot);

  useEffect(() => {
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resync the draft when the persisted root changes underneath us (e.g. Reset Settings or a completed change) */
    setFolderDraft(persistedRoot);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after persisted-root synchronization */
  }, [persistedRoot]);

  const [vaultInstructions, setVaultInstructions] = useAgentsFileDraft(app, "");

  // Settings have no Save button, so the file follows the textarea. Debounced because the
  // alternative is one vault write per keystroke; flushed on unmount so closing the tab
  // mid-sentence still lands the last edit.
  const saveVaultInstructions = useMemo(() => {
    // One chain rather than one promise per call. Debouncing bounds how OFTEN a write starts,
    // not how long one takes: a slow vault (a synced or network-backed one) can still have a
    // save in flight when the next debounce fires, and if that older write lands second it
    // overwrites the newer text with no error and nothing on screen to show for it. Queuing
    // also gives `flush()` a promise that settles only once every queued write has landed.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (next: string): Promise<void> => {
      queue = queue.then(() =>
        writeAgentsFile(app, "", next).catch((error) => {
          logError("Failed to save vault instructions.", error);
          new Notice("Failed to save AGENTS.md.");
        })
      );
      return queue;
    };
    return debounce(enqueue, 1000);
  }, [app]);
  useEffect(() => () => void saveVaultInstructions.flush(), [saveVaultInstructions]);

  const handleOpenVaultInstructions = async () => {
    // Awaited, not fire-and-forget: `openAgentsFile` creates the file when it is missing, so
    // racing an in-flight save lets both paths see it as absent and create it. The loser's
    // write then fails and takes whatever the user typed inside the debounce window with it.
    await saveVaultInstructions.flush();
    // The settings modal sits above the workspace, so close it or the file opens behind it.
    (app as unknown as { setting: { close: () => void } }).setting.close();
    // Empty content on purpose: a vault AGENTS.md starts blank. Nothing is migrated into it,
    // so what the user sees here is only ever what they wrote.
    try {
      await openAgentsFile(app, "", "", true);
    } catch (error) {
      logError("Failed to open vault AGENTS.md.", error);
      new Notice(error instanceof Error ? error.message : "Failed to open AGENTS.md.");
    }
  };

  const applyFolderChange = () => {
    const validation = validateCopilotFolder(folderDraft, app.vault.configDir);
    if (!validation.ok) {
      new Notice(`Invalid Copilot folder: ${validation.reason}`, 5000);
      return;
    }
    const folder = validation.folder;
    if (folder === persistedRoot) {
      new Notice("That's already the Copilot folder.", 3000);
      return;
    }
    // Reason: a path (or ancestor) occupied by an existing FILE would accept
    // and persist fine, but every folder creation under it fails from then on
    // — the first visible symptom being a failed chat save much later.
    const conflict = findCopilotRootFileConflict(app, folder);
    if (conflict) {
      new Notice(
        `"${conflict}" is an existing file, so "${folder}" can't be used as a folder. Choose another location.`,
        8000
      );
      return;
    }
    // Existing Markdown is allowed, but activating the root will exclude all of
    // it from Copilot search. Put that lasting consequence in the confirmation
    // instead of silently accepting or rejecting the user's explicit choice.
    const containsMarkdown = copilotRootContainsNotes(app, folder);
    new ConfirmModal(
      app,
      () => {
        void applyCopilotRootChange(app, folder)
          .then(() => {
            // The root moved, so Miyo's server-side exclusions no longer match.
            // Surface it and stop there: changing a local folder setting must
            // not mutate a remote registration on its own, and the Miyo tab's
            // banner carries the explicit Resync. Reads fresh settings — the
            // React `settings` closure predates the root change.
            const fresh = getSettings();
            const notice = () =>
              new Notice("Miyo search needs a resync — open the Miyo settings tab.", 6000);
            if (shouldSurfaceMiyoResync(app, fresh)) {
              notice();
            } else if (fresh.miyoSyncedExclusions === "") {
              // No local evidence — but a registration made before receipts
              // existed leaves none, and neither does one whose receipt a
              // Reset Settings wiped. Such a vault is still indexed, and its
              // Relay can read the new root, while nothing local would ever
              // report it: the startup notice is gated on the same empty
              // receipt. Only asking the server can tell that apart from
              // "never used Miyo". Read-only — it never mutates the
              // registration; a covering record just self-heals the receipt.
              void verifyMiyoScope(app, miyoMutationSession).then((scope) => {
                if (scope === "stale") notice();
              });
            }
          })
          .then(() => ensureCopilotSubfolders(app.vault, { copilotFolder: folder }))
          .then(() => new Notice(`Copilot folder changed to "${folder}".`, 4000))
          .catch(() => new Notice("Failed to change the Copilot folder. Check the logs.", 5000));
      },
      <CopilotFolderChangeNotice
        oldRoot={persistedRoot}
        newRoot={folder}
        containsMarkdown={containsMarkdown}
      />,
      "",
      containsMarkdown ? "Use folder" : "Change folder",
      "Cancel",
      () => setFolderDraft(persistedRoot)
    ).open();
  };

  const applyCustomNoteFormat = () => {
    setIsChecking(true);

    try {
      // Check required variables
      const format = conversationNoteName || "{$date}_{$time}__{$topic}";
      const requiredVars = ["{$date}", "{$time}", "{$topic}"];
      const missingVars = requiredVars.filter((v) => !format.includes(v));

      if (missingVars.length > 0) {
        new Notice(`Error: Missing required variables: ${missingVars.join(", ")}`, 4000);
        return;
      }

      // Check illegal characters (excluding variable placeholders)
      const illegalChars = /[\\/:*?"<>|]/;
      const formatWithoutVars = format
        .replace(/\{\$date}/g, "")
        .replace(/\{\$time}/g, "")
        .replace(/\{\$topic}/g, "");

      if (illegalChars.test(formatWithoutVars)) {
        new Notice(`Error: Format contains illegal characters (\\/:*?"<>|)`, 4000);
        return;
      }

      // Generate example filename
      const { fileName: timestampFileName } = formatDateTime(new Date());
      const firstTenWords = "test topic name";

      // Create example filename
      const customFileName = format
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      // Save settings
      updateSetting("defaultConversationNoteName", format);
      setConversationNoteName(format);
      new Notice(`Format applied successfully! Example: ${customFileName}`, 4000);
    } catch (error) {
      new Notice(
        `Error applying format: ${error instanceof Error ? error.message : String(error)}`,
        4000
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="tw-space-y-4">
      <PlusSettings />

      <AgentsSection />

      {/* General Section */}
      <SettingSection label="General">
        <SettingItem
          type="select"
          title="Open Plugin In"
          description="Choose where to open the plugin."
          value={settings.defaultOpenArea}
          onChange={(value) => updateSetting("defaultOpenArea", value as DEFAULT_OPEN_AREA)}
          options={[
            { label: "Sidebar View", value: DEFAULT_OPEN_AREA.VIEW },
            { label: "Editor", value: DEFAULT_OPEN_AREA.EDITOR },
          ]}
        />

        <SettingItem
          type="select"
          title="Send Shortcut"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Keyboard shortcut to send messages.</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-xs tw-text-muted">
                      If your selected shortcut doesn&#39;t work, check{" "}
                      <strong>Obsidian → Hotkeys</strong> to see if another command is using the
                      same key combination.
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultSendShortcut}
          onChange={(value) => updateSetting("defaultSendShortcut", value as SEND_SHORTCUT)}
          options={[
            { label: "Enter", value: SEND_SHORTCUT.ENTER },
            { label: "Shift + Enter", value: SEND_SHORTCUT.SHIFT_ENTER },
          ]}
        />

        <SettingItem
          type="custom"
          title="Copilot folder location"
          description="Where Copilot keeps conversations, prompts, memory and more. All sub-folders derive from this."
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <Input
              type="text"
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyFolderChange();
                }
              }}
              placeholder="copilot"
              className="tw-w-full sm:tw-w-[160px]"
              aria-label="Copilot folder"
            />
            <Button
              variant="secondary"
              onClick={applyFolderChange}
              aria-label="Apply Copilot folder"
            >
              Apply
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => revealFolderInExplorer(app, settings.copilotFolder)}
              aria-label="Open Copilot folder"
              title="Open Copilot folder"
            >
              <Folder className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection label="Custom instructions">
        <LegacyChatPromptsNotice />
        {vaultInstructions !== null && (
          <VaultInstructionsSetting
            value={vaultInstructions}
            onChange={(next) => {
              setVaultInstructions(next);
              // Typing never waits on the write; only Open does, via `flush()`.
              void saveVaultInstructions(next);
            }}
            onOpen={() => void handleOpenVaultInstructions()}
          />
        )}
      </SettingSection>

      {/* Saving Conversations Section */}
      <SettingSection label="Saving conversations">
        <SettingItem
          type="switch"
          title="Autosave Chat as Markdown"
          description="Writes each chat to a Markdown note in your vault after every user message and AI response. With this off, agent chats still appear in Recent Chats from session history; only the Markdown note is skipped."
          checked={settings.autosaveChat}
          onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
        />

        {/* Not gated on autosave: the "Save Chat as Note" button appears only
            when autosave is off, and it names its note from this same template,
            so gating would hide the control exactly where it is the only one. */}
        <Collapsible open={templateOpen} onOpenChange={setTemplateOpen}>
          <CollapsibleTrigger asChild>
            <SettingDisclosure open={templateOpen} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SettingItem
              type="custom"
              title="Conversation Filename Template"
              description={
                <div className="tw-flex tw-items-start tw-gap-1.5 ">
                  <span className="tw-leading-none">
                    Customize the format of saved conversation note names.
                  </span>
                  <HelpTooltip
                    content={
                      <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                        <div className="tw-text-sm tw-font-medium tw-text-accent">
                          Note: All the following variables must be included in the template.
                        </div>
                        <div>
                          <div className="tw-text-sm tw-font-medium tw-text-muted">
                            Available variables:
                          </div>
                          <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                            <li>
                              <strong>{"{$date}"}</strong>: Date in YYYYMMDD format
                            </li>
                            <li>
                              <strong>{"{$time}"}</strong>: Time in HHMMSS format
                            </li>
                            <li>
                              <strong>{"{$topic}"}</strong>: Chat conversation topic
                            </li>
                          </ul>
                          <i className="tw-mt-2 tw-text-sm tw-text-muted">
                            Example: {"{$date}_{$time}__{$topic}"} →
                            20250114_153232__polish_this_article_[[Readme]]
                          </i>
                        </div>
                      </div>
                    }
                  />
                </div>
              }
            >
              <div className="tw-flex tw-w-[320px] tw-items-center tw-gap-1.5">
                <Input
                  type="text"
                  className={cn(
                    "tw-min-w-[80px] tw-grow tw-transition-all tw-duration-200",
                    isChecking ? "tw-w-[80px]" : "tw-w-[120px]"
                  )}
                  placeholder="{$date}_{$time}__{$topic}"
                  value={conversationNoteName}
                  onChange={(e) => setConversationNoteName(e.target.value)}
                  disabled={isChecking}
                />

                <Button
                  onClick={() => applyCustomNoteFormat()}
                  disabled={isChecking}
                  variant="secondary"
                >
                  {isChecking ? (
                    <>
                      <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                      Apply
                    </>
                  ) : (
                    "Apply"
                  )}
                </Button>
              </div>
            </SettingItem>
          </CollapsibleContent>
        </Collapsible>
      </SettingSection>
    </div>
  );
};
