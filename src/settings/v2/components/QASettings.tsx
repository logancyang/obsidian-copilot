import { PatternMatchingModal } from "@/components/modals/PatternMatchingModal";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import VectorStoreManager from "@/search/vectorStoreManager";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { HelpCircle } from "lucide-react";
import React from "react";

export const QASettings: React.FC = () => {
  const settings = useSettingsValue();

  const handlePartitionsChange = (value: string) => {
    const numValue = parseInt(value);
    if (numValue !== settings.numPartitions) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("numPartitions", numValue);
        await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
      }).open();
    }
  };

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-space-y-4">
          {/* Auto-Index Strategy */}
          <SettingItem
            type="select"
            title="Auto-Index Strategy"
            description={
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-leading-none">
                  Decide when you want the vault to be indexed.
                </span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="tw-size-4" />
                    </TooltipTrigger>
                    <TooltipContent>
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
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
            description="Copilot goes through your vault to find relevant blocks and passes the top N blocks to the LLM. Default for N is 3. Increase if you want more sources included in the answer generation step."
            min={1}
            max={128}
            step={1}
            value={settings.maxSourceChunks}
            onChange={(value) => updateSetting("maxSourceChunks", value)}
          />

          {/* Requests per Minute */}
          <SettingItem
            type="slider"
            title="Requests per Minute"
            description="Default is 90. Decrease if you are rate limited by your embedding provider."
            min={10}
            max={300}
            step={10}
            value={settings.embeddingRequestsPerMin}
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
            value={settings.numPartitions.toString()}
            onChange={handlePartitionsChange}
            options={[
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "12",
              "16",
              "20",
              "24",
              "28",
              "32",
              "36",
              "40",
            ].map((it) => ({
              label: it,
              value: it,
            }))}
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
            description="If enabled, the index will be stored in the .obsidian folder and synced with Obsidian Sync by default. If disabled, it will be stored in .copilot-index folder at vault root."
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
