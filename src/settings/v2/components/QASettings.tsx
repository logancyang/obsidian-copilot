import { PatternMatchingModal } from "@/components/modals/PatternMatchingModal";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { SemanticSearchToggleModal } from "@/components/modals/SemanticSearchToggleModal";
import { Button } from "@/components/ui/button";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { SettingItem } from "@/components/ui/setting-item";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import { getModelKeyFromModel, updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

export const QASettings: React.FC = () => {
  const settings = useSettingsValue();

  const handleSetDefaultEmbeddingModel = async (modelKey: string) => {
    if (modelKey === settings.embeddingModelKey) return;

    if (settings.enableSemanticSearchV3) {
      // Persist only after user confirms rebuild
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("embeddingModelKey", modelKey);
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
      }).open();
      return;
    }

    // Persist without rebuild when semantic search is disabled
    updateSetting("embeddingModelKey", modelKey);
    new Notice("Embedding model saved. Enable Semantic Search to build the index.");
  };

  // Partitions are automatically managed in v3 (150MB per JSONL partition).
  // Remove UI control; keep handler stub to avoid accidental usage.
  // const handlePartitionsChange = (_value: string) => {};

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-space-y-4">
          {/* Enable Semantic Search (v3) */}
          <SettingItem
            type="switch"
            title="Enable Semantic Search"
            description="Enable semantic search for meaning-based document retrieval. When disabled, uses fast lexical search only. Use 'Refresh Vault Index' or 'Force Reindex Vault' to build the embedding index."
            checked={settings.enableSemanticSearchV3}
            onCheckedChange={(checked) => {
              // Show confirmation modal with appropriate message
              new SemanticSearchToggleModal(
                app,
                async () => {
                  updateSetting("enableSemanticSearchV3", checked);
                  if (checked) {
                    const VectorStoreManager = (await import("@/search/vectorStoreManager"))
                      .default;
                    await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
                  }
                },
                checked // true = enabling, false = disabling
              ).open();
            }}
          />

          {/* Enable Inline Citations */}
          <SettingItem
            type="switch"
            title="Enable Inline Citations (experimental)"
            description="When enabled, AI responses will include footnote-style citations within the text and numbered sources at the end. This is an experimental feature and may not work as expected for all models."
            checked={settings.enableInlineCitations}
            onCheckedChange={(checked) => updateSetting("enableInlineCitations", checked)}
          />

          {/* Embedding Model - Always shown to reduce ambiguity */}
          <SettingItem
            type="select"
            title="Embedding Model"
            description={
              <div className="tw-space-y-2">
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <span className="tw-font-medium tw-leading-none tw-text-accent">
                    Powers Semantic Vault Search and Relevant Notes. Enable Semantic Search to use
                    it.
                  </span>
                  <HelpTooltip
                    content={
                      <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2">
                        <div className="tw-pt-2 tw-text-sm tw-text-muted">
                          This model converts text into vector representations, essential for
                          semantic search and Question Answering (QA) functionality. Changing the
                          embedding model will:
                        </div>
                        <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                          <li>Require rebuilding your vault&#39;s vector index</li>
                          <li>Affect semantic search quality</li>
                          <li>Impact Question Answering feature performance</li>
                        </ul>
                      </div>
                    }
                  />
                </div>
              </div>
            }
            value={settings.embeddingModelKey}
            onChange={handleSetDefaultEmbeddingModel}
            options={settings.activeEmbeddingModels.map((model) => ({
              label: getModelDisplayWithIcons(model),
              value: getModelKeyFromModel(model),
            }))}
            placeholder="Model"
          />

          {/* Auto-Index Strategy */}
          <SettingItem
            type="select"
            title="Auto-Index Strategy"
            description={
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-leading-none">
                  Decide when you want the vault to be indexed.
                </span>
                <HelpTooltip
                  content={
                    <div className="tw-space-y-2 tw-py-2">
                      <div className="tw-space-y-1">
                        <div className="tw-text-sm tw-text-muted">
                          Choose when to index your vault:
                        </div>
                        <ul className="tw-list-disc tw-space-y-1 tw-pl-2 tw-text-sm">
                          <li>
                            <div className="tw-flex tw-items-center tw-gap-1">
                              <strong className="tw-inline-block tw-whitespace-nowrap">
                                NEVER:
                              </strong>
                              <span>Manual indexing via command or refresh only</span>
                            </div>
                          </li>
                          <li>
                            <div className="tw-flex tw-items-center tw-gap-1">
                              <strong className="tw-inline-block tw-whitespace-nowrap">
                                ON STARTUP:
                              </strong>
                              <span>Index updates when plugin loads or reloads</span>
                            </div>
                          </li>
                          <li>
                            <div className="tw-flex tw-items-center tw-gap-1">
                              <strong className="tw-inline-block tw-whitespace-nowrap">
                                ON MODE SWITCH:
                              </strong>
                              <span>Updates when entering QA mode (Recommended)</span>
                            </div>
                          </li>
                        </ul>
                      </div>
                      <p className="tw-text-sm tw-text-callout-warning">
                        Warning: Cost implications for large vaults with paid models
                      </p>
                    </div>
                  }
                />
              </div>
            }
            value={settings.indexVaultToVectorStore}
            onChange={(value) => {
              updateSetting("indexVaultToVectorStore", value);
            }}
            options={VAULT_VECTOR_STORE_STRATEGIES.map((strategy) => ({
              label: strategy,
              value: strategy,
            }))}
            placeholder="Strategy"
          />

          {/* Max Sources */}
          <SettingItem
            type="slider"
            title="Max Sources"
            description="Copilot goes through your vault to find relevant notes and passes the top N to the LLM. Default for N is 15. Increase if you want more notes included in the answer generation step."
            min={1}
            max={128}
            step={1}
            value={settings.maxSourceChunks}
            onChange={(value) => updateSetting("maxSourceChunks", value)}
          />

          {/* Embedding-related settings - Only shown when semantic search is enabled */}
          {settings.enableSemanticSearchV3 && (
            <>
              {/* Requests per Minute */}
              <SettingItem
                type="slider"
                title="Requests per Minute"
                description="Default is 60. Decrease if you are rate limited by your embedding provider."
                min={10}
                max={60}
                step={10}
                value={Math.min(settings.embeddingRequestsPerMin, 60)}
                onChange={(value) => updateSetting("embeddingRequestsPerMin", value)}
              />

              {/* Embedding batch size */}
              <SettingItem
                type="slider"
                title="Embedding Batch Size"
                description="Default is 16. Increase if you are rate limited by your embedding provider."
                min={1}
                max={128}
                step={1}
                value={settings.embeddingBatchSize}
                onChange={(value) => updateSetting("embeddingBatchSize", value)}
              />

              {/* Number of Partitions */}
              <SettingItem
                type="select"
                title="Number of Partitions"
                description="Number of partitions for Copilot index. Default is 1. Increase if you have issues indexing large vaults. Warning: Changes require clearing and rebuilding the index!"
                value={String(settings.numPartitions || 1)}
                onChange={(value) => updateSetting("numPartitions", Number(value))}
                options={[
                  { label: "1", value: "1" },
                  { label: "2", value: "2" },
                  { label: "4", value: "4" },
                  { label: "8", value: "8" },
                  { label: "16", value: "16" },
                  { label: "32", value: "32" },
                  { label: "40", value: "40" },
                ]}
                placeholder="Select partitions"
              />
            </>
          )}

          {/* Lexical Search RAM Limit */}
          <SettingItem
            type="slider"
            title="Lexical Search RAM Limit"
            description="Maximum RAM usage for full-text search index. Lower values use less memory but may limit search performance on large vaults. Default is 100 MB."
            min={20}
            max={1000}
            step={20}
            value={settings.lexicalSearchRamLimit || 100}
            onChange={(value) => updateSetting("lexicalSearchRamLimit", value)}
            suffix=" MB"
          />

          {/* Enable Folder and Graph Boosts */}
          <SettingItem
            type="switch"
            title="Enable Folder and Graph Boosts"
            description="Enable folder and graph-based relevance boosts for lexical search results. When disabled, provides pure keyword-based relevance scoring without folder or connection-based adjustments."
            checked={settings.enableLexicalBoosts}
            onCheckedChange={(checked) => updateSetting("enableLexicalBoosts", checked)}
          />

          {/* Exclusions */}
          <SettingItem
            type="custom"
            title="Exclusions"
            description={
              <>
                <p>
                  Exclude folders, tags, note titles or file extensions from being indexed.
                  Previously indexed files will remain until a force re-index is performed.
                </p>
              </>
            }
          >
            <Button
              variant="secondary"
              onClick={() =>
                new PatternMatchingModal(
                  app,
                  (value) => updateSetting("qaExclusions", value),
                  settings.qaExclusions,
                  "Manage Exclusions"
                ).open()
              }
            >
              Manage
            </Button>
          </SettingItem>

          {/* Inclusions */}
          <SettingItem
            type="custom"
            title="Inclusions"
            description={
              <p>
                Index only the specified paths, tags, or note titles. Exclusions take precedence
                over inclusions. Previously indexed files will remain until a force re-index is
                performed.
              </p>
            }
          >
            <Button
              variant="secondary"
              onClick={() =>
                new PatternMatchingModal(
                  app,
                  (value) => updateSetting("qaInclusions", value),
                  settings.qaInclusions,
                  "Manage Inclusions"
                ).open()
              }
            >
              Manage
            </Button>
          </SettingItem>

          {/* Enable Obsidian Sync */}
          <SettingItem
            type="switch"
            title="Enable Obsidian Sync for Copilot index"
            description="If enabled, store the semantic index in .obsidian so it syncs with Obsidian Sync. If disabled, store it under .copilot/ at the vault root."
            checked={settings.enableIndexSync}
            onCheckedChange={(checked) => updateSetting("enableIndexSync", checked)}
          />

          {/* Disable index loading on mobile */}
          <SettingItem
            type="switch"
            title="Disable index loading on mobile"
            description="When enabled, Copilot index won't be loaded on mobile devices to save resources. Only chat mode will be available. Any existing index from desktop sync will be preserved. Uncheck to enable QA modes on mobile."
            checked={settings.disableIndexOnMobile}
            onCheckedChange={(checked) => updateSetting("disableIndexOnMobile", checked)}
          />
        </div>
      </section>
    </div>
  );
};
