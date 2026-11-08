import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { Info, ShieldCheck, Trash2 } from "lucide-react";
import React from "react";

export type ApiKeyStorageStatus = "unavailable" | "empty" | "stored";

export interface ApiKeyStorageSectionProps {
  status: ApiKeyStorageStatus;
  forgetting: boolean;
  onForgetAll: () => void;
}

export const ApiKeyStorageSection: React.FC<ApiKeyStorageSectionProps> = ({
  status,
  forgetting,
  onForgetAll,
}) => {
  const keychainAvailable = status !== "unavailable";

  return (
    <SettingSection label="Others">
      <SettingItem
        type="custom"
        title="API key storage"
        description={
          status === "unavailable" ? (
            <>
              Update Obsidian to <code>1.11.4+</code> to use the{" "}
              <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>. Keys
              cannot be loaded or saved in this build.
            </>
          ) : status === "empty" ? (
            <span className="tw-text-warning">
              No API keys found in this device&apos;s{" "}
              <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
              Re-enter your API keys in the relevant settings sections — each device has a separate
              Keychain.
            </span>
          ) : (
            <>
              API keys are stored in this device&apos;s{" "}
              <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
            </>
          )
        }
      >
        <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
          {keychainAvailable ? (
            <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
              <ShieldCheck className="tw-size-4" />
              Obsidian Keychain
            </div>
          ) : (
            <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
              <Info className="tw-size-4" />
              Unavailable
            </div>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={onForgetAll}
            disabled={forgetting || !keychainAvailable}
            title={
              keychainAvailable
                ? undefined
                : "Update Obsidian to 1.11.4+ to delete Keychain entries."
            }
            className="tw-gap-1.5"
          >
            <Trash2 className="tw-size-4" />
            {forgetting ? "Removing..." : "Delete All Keys"}
          </Button>
        </div>
      </SettingItem>
    </SettingSection>
  );
};
