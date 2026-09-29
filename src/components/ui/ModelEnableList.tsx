import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FreeModelWarningIcon } from "@/components/ui/FreeModelWarningIcon";
import { LicenseRequiredIcon } from "@/components/ui/LicenseRequiredIcon";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingSwitch } from "@/components/ui/setting-switch";
import type { ModelCapability } from "@/constants";
import { cn } from "@/lib/utils";
import { ChevronRight, KeyRound } from "lucide-react";
import React from "react";

const SETTINGS_PRICING_URL = createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "model_settings_lock");

export interface ModelEnableRow {
  id: string;
  label: string;
  description?: string;
  wireId?: string;
  enabled: boolean;
  capabilities?: ModelCapability[];
  isFree?: boolean;
  locked?: boolean;
}

export interface ModelEnableGroup {
  key: string;
  label: string;
  badge?: string;
  tooltip?: string;
  highlight?: boolean;
  rows: ModelEnableRow[];
}

interface ModelEnableListProps {
  groups: ModelEnableGroup[];
  onToggle: (id: string, enabled: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
  searchPlaceholder?: string;
  emptyState?: React.ReactNode;
  defaultOpenGroupKey?: string;
}

export const ModelEnableList: React.FC<ModelEnableListProps> = ({
  groups,
  onToggle,
  query,
  onQueryChange,
  searchPlaceholder = "Search models…",
  emptyState,
  defaultOpenGroupKey,
}) => {
  const searching = query.trim().length > 0;

  const [userOpen, setUserOpen] = React.useState<Record<string, boolean>>({});
  const isOpen = (key: string) => {
    if (searching) return true;
    if (key in userOpen) return userOpen[key];
    return defaultOpenGroupKey === undefined || key === defaultOpenGroupKey;
  };
  const handleOpenChange = (key: string, open: boolean) =>
    setUserOpen((prev) => ({ ...prev, [key]: open }));

  const renderRows = (rows: ModelEnableRow[]): React.ReactNode => (
    <div className="tw-space-y-1">
      {rows.map((row) => {
        // A locked row is a link, so it must not contain an enable control.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
        const Row = row.locked ? "a" : "div";
        return (
          <Row
            key={row.id}
            href={row.locked ? SETTINGS_PRICING_URL : undefined}
            target={row.locked ? "_blank" : undefined}
            rel={row.locked ? "noopener noreferrer" : undefined}
            className={cn(
              "tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded tw-px-2 tw-py-1",
              "hover:tw-bg-modifier-hover",
              row.locked &&
                "tw-text-normal tw-no-underline hover:tw-text-normal hover:tw-no-underline focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
            )}
          >
            <div className="tw-min-w-0">
              <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span className="tw-truncate">{row.label}</span>
                {row.locked && <LicenseRequiredIcon />}
                {row.isFree && <FreeModelWarningIcon />}
                {hasCapabilityIcons(row.capabilities) && (
                  <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
                    <ModelCapabilityIcons capabilities={row.capabilities} iconSize={14} />
                  </span>
                )}
              </div>
              {row.description && (
                <div className="tw-truncate tw-text-xs tw-text-muted">{row.description}</div>
              )}
            </div>
            {row.locked ? (
              <SettingSwitch
                checked={false}
                disabled
                role="presentation"
                aria-hidden
                tabIndex={undefined}
                className="tw-pointer-events-none"
              />
            ) : (
              <SettingSwitch
                checked={row.enabled}
                onCheckedChange={(next) => onToggle(row.id, next)}
              />
            )}
          </Row>
        );
      })}
    </div>
  );

  const hasRows = groups.some((g) => g.rows.length > 0);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <SearchBar value={query} onChange={onQueryChange} placeholder={searchPlaceholder} />

      <div className="tw-max-h-80 tw-overflow-y-auto tw-pr-1">
        {!hasRows ? (
          <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            {emptyState ?? (searching ? `No models match “${query.trim()}”.` : "No models.")}
          </div>
        ) : (
          <div className="tw-space-y-2">
            {groups
              .filter((g) => g.rows.length > 0)
              .map((group) => (
                <Collapsible
                  key={group.key}
                  open={isOpen(group.key)}
                  onOpenChange={(open) => handleOpenChange(group.key, open)}
                >
                  <CollapsibleTrigger asChild>
                    <div className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-medium tw-font-bold hover:tw-bg-modifier-hover">
                      <ChevronRight
                        className={cn(
                          "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
                          isOpen(group.key) && "tw-rotate-90"
                        )}
                      />
                      <span
                        className={cn(
                          "tw-truncate",
                          group.highlight && "tw-font-bold tw-text-accent"
                        )}
                      >
                        {group.label}
                      </span>
                      {group.badge && (
                        <Badge variant="secondary" className="tw-shrink-0 tw-font-normal">
                          {group.badge}
                        </Badge>
                      )}
                      {group.tooltip && (
                        <span
                          className="tw-flex tw-shrink-0 tw-items-center"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <HelpTooltip
                            content={group.tooltip}
                            side="top"
                            buttonClassName="tw-size-4"
                          >
                            <KeyRound className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
                          </HelpTooltip>
                        </span>
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="tw-pl-4">{renderRows(group.rows)}</div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
