import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import React from "react";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
  warningLabel?: string;
  warningTone?: "warning" | "error";
}

export type TabVariant = "page" | "inline";

interface TabItemProps {
  tab: TabItem;
  isSelected: boolean;
  onClick: () => void;
  variant?: TabVariant;
}

export const TabItem: React.FC<TabItemProps> = ({ tab, isSelected, onClick, variant = "page" }) => {
  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-controls={`tabpanel-${tab.id}`}
      aria-selected={isSelected}
      aria-label={tab.warningLabel ? `${tab.label}: ${tab.warningLabel}` : tab.label}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "tw-relative tw-flex tw-flex-row tw-items-center",
        "tw-h-8",
        "tw-px-2 tw-py-1",
        "tw-gap-1.5",
        "tw-cursor-pointer",
        "tw-overflow-hidden",
        "tw-whitespace-nowrap",
        "tw-text-sm",
        "tw-border tw-border-solid tw-border-border",
        variant === "page" ? "tw-rounded-b-[2px] tw-rounded-t-sm" : "tw-rounded-md",
        "tw-bg-primary",
        "tw-transition-all tw-duration-300 tw-ease-in-out",
        "hover:tw-border-interactive-accent",
        "focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
        isSelected && [
          "!tw-bg-interactive-accent",
          "tw-text-on-accent",
          "!tw-max-w-full",
          "tw-transition-all tw-duration-300 tw-ease-in-out",
          "tw-delay-100",
        ],
        isSelected && variant === "inline" && "!tw-border-interactive-accent",
        "lg:tw-max-w-32",
        "md:tw-max-w-32"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-size-4",
          "tw-transition-transform tw-duration-200 tw-ease-in-out",
          isSelected
            ? "tw-max-w-[16px] tw-translate-x-0 tw-opacity-100"
            : "tw-max-w-0 tw--translate-x-4 tw-opacity-0"
        )}
      >
        {tab.icon}
      </div>
      <span
        className={cn(
          "tw-text-sm",
          "tw-font-medium",
          "tw-transition-all tw-duration-200 tw-ease-in-out",
          "tw-overflow-hidden tw-whitespace-nowrap",
          "tw-max-w-[100px] tw-translate-x-0 tw-opacity-100"
        )}
      >
        {tab.label}
      </span>
      {/* https://github.com/Brevilabs/obsidian-copilot-private/issues/166 The Skills panel is unmounted while inactive, so the tab carries the marker. */}
      {tab.warningLabel && (
        <WarningDot tab={tab} className="tw-pointer-events-none tw-absolute tw-right-1 tw-top-1" />
      )}
    </div>
  );
};

const WarningDot: React.FC<{ tab: TabItem; className?: string }> = ({ tab, className }) => (
  <span
    aria-hidden="true"
    title={tab.warningLabel}
    className={cn(
      "tw-size-1.5 tw-shrink-0 tw-rounded-full",
      tab.warningTone === "error" ? "tw-bg-modifier-error" : "tw-bg-warning",
      className
    )}
  />
);

interface TabStripLayoutInput {
  widths: readonly number[];
  selectedIndex: number;
  available: number;
  gap: number;
  overflowWidth: number;
}

export function computeVisibleTabIndices({
  widths,
  selectedIndex,
  available,
  gap,
  overflowWidth,
}: TabStripLayoutInput): number[] {
  const rowWidth = (indices: readonly number[]) =>
    indices.reduce((sum, i) => sum + widths[i], 0) + gap * Math.max(0, indices.length - 1);

  const all = widths.map((_, i) => i);
  if (rowWidth(all) <= available) return all;

  const budget = available - overflowWidth - gap;
  const visible: number[] = [];
  for (const i of all) {
    if (rowWidth([...visible, i]) > budget) break;
    visible.push(i);
  }
  if (visible.includes(selectedIndex)) return visible;

  // https://github.com/Brevilabs/obsidian-copilot-private/issues/891 The selected tab must stay visible and highlighted, so it takes the last slot like Agent Mode chat tabs.
  while (visible.length > 0 && rowWidth([...visible, selectedIndex]) > budget) visible.pop();
  return [...visible, selectedIndex];
}

interface StripMeasurements {
  available: number;
  gap: number;
  overflowWidth: number;
  widths: Readonly<Record<string, number>>;
}

function sameMeasurements(a: StripMeasurements, b: StripMeasurements): boolean {
  const aIds = Object.keys(a.widths);
  return (
    a.available === b.available &&
    a.gap === b.gap &&
    a.overflowWidth === b.overflowWidth &&
    aIds.length === Object.keys(b.widths).length &&
    aIds.every((id) => a.widths[id] === b.widths[id])
  );
}

const OFF_STRIP_CLASS = "tw-invisible tw-absolute tw-left-0 tw-top-0";

interface SettingTabStripProps<Id extends string> {
  tabs: readonly (TabItem & { id: Id })[];
  selectedId: Id;
  onSelect: (id: Id) => void;
  variant?: TabVariant;
}

export function SettingTabStrip<Id extends string>({
  tabs,
  selectedId,
  onSelect,
  variant = "page",
}: SettingTabStripProps<Id>): JSX.Element {
  const stripRef = React.useRef<HTMLDivElement>(null);
  const overflowRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [measurements, setMeasurements] = React.useState<StripMeasurements | null>(null);
  const tabIdsKey = tabs.map((tab) => tab.id).join("\n");

  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const measure = () => {
      const widths: Record<string, number> = {};
      tabRefs.current.forEach((el, id) => {
        widths[id] = el.getBoundingClientRect().width;
      });
      const next: StripMeasurements = {
        available: strip.getBoundingClientRect().width,
        gap: parseFloat(strip.win.getComputedStyle(strip).columnGap) || 0,
        overflowWidth: overflowRef.current?.getBoundingClientRect().width ?? 0,
        widths,
      };
      setMeasurements((prev) => (prev && sameMeasurements(prev, next) ? prev : next));
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    tabRefs.current.forEach((el) => ro.observe(el));
    if (overflowRef.current) ro.observe(overflowRef.current);
    return () => ro.disconnect();
  }, [tabIdsKey]);

  const visibleIndices = measurements
    ? computeVisibleTabIndices({
        widths: tabs.map((tab) => measurements.widths[tab.id] ?? 0),
        selectedIndex: tabs.findIndex((tab) => tab.id === selectedId),
        available: measurements.available,
        gap: measurements.gap,
        overflowWidth: measurements.overflowWidth,
      })
    : tabs.map((_, i) => i);
  const visibleTabs = visibleIndices.map((i) => tabs[i]);
  const overflowTabs = tabs.filter((tab) => !visibleTabs.includes(tab));

  return (
    <div
      ref={stripRef}
      role="tablist"
      className={cn("tw-relative tw-flex tw-min-w-0", variant === "inline" && "tw-gap-1")}
    >
      {[...visibleTabs, ...overflowTabs].map((tab) => {
        const inOverflow = overflowTabs.includes(tab);
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            aria-hidden={inOverflow || undefined}
            className={cn("tw-shrink-0", inOverflow && OFF_STRIP_CLASS)}
          >
            <TabItem
              tab={tab}
              isSelected={tab.id === selectedId}
              onClick={() => onSelect(tab.id)}
              variant={variant}
            />
          </div>
        );
      })}
      <div
        ref={overflowRef}
        aria-hidden={overflowTabs.length === 0 || undefined}
        className={cn("tw-shrink-0", overflowTabs.length === 0 && OFF_STRIP_CLASS)}
      >
        <TabOverflowMenu tabs={overflowTabs} onSelect={onSelect} />
      </div>
    </div>
  );
}

interface TabOverflowMenuProps<Id extends string> {
  tabs: readonly (TabItem & { id: Id })[];
  onSelect: (id: Id) => void;
}

function TabOverflowMenu<Id extends string>({
  tabs,
  onSelect,
}: TabOverflowMenuProps<Id>): JSX.Element {
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/166 A warning on a tab hidden in the menu must stay visible from every settings section.
  const flaggedTab =
    tabs.find((tab) => tab.warningLabel && tab.warningTone === "error") ??
    tabs.find((tab) => tab.warningLabel);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className="tw-relative tw-size-8"
          aria-label={`Show ${tabs.length} more tab${tabs.length === 1 ? "" : "s"}`}
        >
          <MoreHorizontal className="tw-size-4" />
          {flaggedTab && (
            <WarningDot
              tab={flaggedTab}
              className="tw-pointer-events-none tw-absolute tw-right-1 tw-top-1"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.id}
            aria-label={tab.warningLabel ? `${tab.label}: ${tab.warningLabel}` : tab.label}
            onSelect={() => onSelect(tab.id)}
          >
            <span className="tw-min-w-0 tw-flex-1 tw-truncate">{tab.label}</span>
            {tab.warningLabel && <WarningDot tab={tab} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TabContentProps {
  id: string;
  children: React.ReactNode;
  isSelected: boolean;
  variant?: TabVariant;
}

export const TabContent: React.FC<TabContentProps> = ({
  id,
  children,
  isSelected,
  variant = "page",
}) => {
  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={cn(
        variant === "page" ? "tw-mt-4 tw-rounded-lg tw-bg-secondary tw-p-4" : "tw-mt-3",
        "tw-transition-all tw-duration-200 tw-ease-in-out",
        isSelected ? "tw-translate-y-0 tw-opacity-100" : "tw-translate-y-2 tw-opacity-0"
      )}
    >
      {children}
    </div>
  );
};
