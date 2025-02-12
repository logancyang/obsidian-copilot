import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingItem } from "@/components/ui/setting-item";
import { VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import { useTab } from "@/contexts/TabContext";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { HelpCircle } from "lucide-react";
import React from "react";

interface QASettingsProps {
  indexVaultToVectorStore(overwrite?: boolean): Promise<number>;
}

const QASettings: React.FC<QASettingsProps> = ({ indexVaultToVectorStore }) => {
  const { modalContainer } = useTab();
  const settings = useSettingsValue();
  const [openPopoverIds, setOpenPopoverIds] = React.useState<Set<string>>(new Set());

  const handlePopoverOpen = (id: string) => {
    setOpenPopoverIds((prev) => new Set([...prev, id]));
  };

  const handlePopoverClose = (id: string) => {
    setOpenPopoverIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const handlePartitionsChange = (value: string) => {
    const numValue = parseInt(value);
    if (numValue !== settings.numPartitions) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("numPartitions", numValue);
        await indexVaultToVectorStore(true);
      }).open();
    }
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="space-y-4">
          {/* Auto-Index Strategy */}
          <SettingItem
            type="select"
            title="Auto-Index Strategy"
            description={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Decide when you want the vault to be indexed.</span>
                <Popover
                  open={openPopoverIds.has("index-help")}
                  onOpenChange={(open) => {
                    if (open) {
                      handlePopoverOpen("index-help");
                    } else {
                      handlePopoverClose("index-help");
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <HelpCircle
                      className="h-5 w-5 sm:h-4 sm:w-4 cursor-pointer text-muted hover:text-accent translate-y-[1px]"
                      onMouseEnter={() => handlePopoverOpen("index-help")}
                      onMouseLeave={() => handlePopoverClose("index-help")}
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    container={modalContainer}
                    className="w-[90vw] max-w-[400px] p-2 sm:p-3"
                    side="bottom"
                    align="center"
                    sideOffset={0}
                    onMouseEnter={() => handlePopoverOpen("index-help")}
                    onMouseLeave={() => handlePopoverClose("index-help")}
                  >
                    <div className="space-y-2 sm:space-y-2.5">
                      <div className="rounded bg-callout-warning/10 p-1.5 sm:p-2 ring-ring">
                        <p className="text-callout-warning text-xs sm:text-sm">
                          Warning: Cost implications for large vaults with paid models
                        </p>
                      </div>
                      <div className="space-y-1 sm:space-y-1.5">
                        <p className="text-muted text-[11px] sm:text-xs">
                          Choose when to index your vault:
                        </p>
                        <ul className="space-y-1 pl-2 sm:pl-3 list-disc text-[11px] sm:text-xs">
                          <li>
                            <strong className="inline-block whitespace-nowrap">NEVER：</strong>
                            <span>Manual indexing via command or refresh only</span>
                          </li>
                          <li>
                            <strong className="inline-block whitespace-nowrap">ON STARTUP：</strong>
                            <span>Index updates when plugin loads or reloads</span>
                          </li>
                          <li>
                            <strong className="inline-block whitespace-nowrap">
                              ON MODE SWITCH：
                            </strong>
                            <span>Updates when entering QA mode (Recommended)</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
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

          {/* Requests per second */}
          <SettingItem
            type="slider"
            title="Requests per second"
            description="Default is 10. Decrease if you are rate limited by your embedding provider."
            min={1}
            max={10}
            step={1}
            value={settings.embeddingRequestsPerSecond}
            onChange={(value) => updateSetting("embeddingRequestsPerSecond", value)}
          />

          {/* Embedding batch size */}
          <SettingItem
            type="slider"
            title="Embedding batch size"
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
            type="textarea"
            title="Exclusions"
            description={
              <>
                <p>
                  Comma separated list of paths, tags, note titles or file extension will be
                  excluded from the indexing process. e.g. folder1, folder1/folder2, #tag1, #tag2,
                  [[note1]], [[note2]], *.jpg, *.excallidraw.md etc,
                </p>
                <em>
                  NOTE: Tags must be in the note properties, not the note content. Files which were
                  previously indexed will remain in the index unless you force re-index.
                </em>
              </>
            }
            value={settings.qaExclusions}
            onChange={(value) => updateSetting("qaExclusions", value)}
            placeholder="folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md"
          />

          {/* Inclusions */}
          <SettingItem
            type="textarea"
            title="Inclusions"
            description="When specified, ONLY these paths, tags, or note titles will be indexed (comma separated). Takes precedence over exclusions. Files which were previously indexed will remain in the index unless you force re-index. Format: folder1, folder1/folder2, #tag1, #tag2, [[note1]], [[note2]]"
            value={settings.qaInclusions}
            onChange={(value) => updateSetting("qaInclusions", value)}
            placeholder="folder1, #tag1, [[note1]]"
          />

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

export default QASettings;
