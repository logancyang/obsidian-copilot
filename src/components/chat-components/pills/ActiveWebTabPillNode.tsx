import React from "react";
import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  $getRoot,
} from "lexical";
import { Globe } from "lucide-react";
import { Platform } from "obsidian";
import { ACTIVE_WEB_TAB_MARKER } from "@/constants";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";
import { useActiveWebTabState } from "../hooks/useActiveWebTabState";

export type SerializedActiveWebTabPillNode = SerializedBasePillNode;

/**
 * ActiveWebTabPillNode represents the "Current Web Tab" in context.
 * It automatically displays whatever web tab is currently active in Obsidian Web Viewer.
 * Desktop-only feature.
 */
export class ActiveWebTabPillNode extends BasePillNode {
  static getType(): string {
    return "active-web-tab-pill";
  }

  static clone(node: ActiveWebTabPillNode): ActiveWebTabPillNode {
    return new ActiveWebTabPillNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super("Current Web Tab", key);
  }

  getClassName(): string {
    return "active-web-tab-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-active-web-tab-pill";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "active-web-tab-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-active-web-tab-pill")) {
          return {
            conversion: convertActiveWebTabPillElement,
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  static importJSON(_serializedNode: SerializedActiveWebTabPillNode): ActiveWebTabPillNode {
    return $createActiveWebTabPillNode();
  }

  exportJSON(): SerializedActiveWebTabPillNode {
    return {
      ...super.exportJSON(),
      type: "active-web-tab-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-active-web-tab-pill", "true");
    element.textContent = ACTIVE_WEB_TAB_MARKER;
    return { element };
  }

  getTextContent(): string {
    return ACTIVE_WEB_TAB_MARKER;
  }

  decorate(): JSX.Element {
    return <ActiveWebTabPillComponent />;
  }
}

function convertActiveWebTabPillElement(_domNode: HTMLElement): DOMConversionOutput | null {
  const node = $createActiveWebTabPillNode();
  return { node };
}

/**
 * Component that renders the active web tab pill.
 * Uses activeWebTabForMentions to match the actual send behavior:
 * - Has value when web tab is active OR when switched directly to chat panel
 * - Null when switched to other views (e.g., note tab)
 * This ensures UI display matches what will actually be sent.
 */
function ActiveWebTabPillComponent(): JSX.Element {
  // Use activeWebTabForMentions to match send behavior (not activeOrLastWebTab)
  const { activeWebTabForMentions } = useActiveWebTabState();

  // Not supported on mobile
  if (!Platform.isDesktopApp) {
    return (
      <PillBadge>
        <div className="tw-flex tw-items-center tw-gap-1">
          <Globe className="tw-size-3" />
          <TruncatedPillText
            content="activeWebTab"
            openBracket="{"
            closeBracket="}"
            tooltipContent={<div className="tw-text-left">Web Viewer not supported on mobile</div>}
          />
        </div>
      </PillBadge>
    );
  }

  // No active web tab (matches Active Note pill behavior when no active note)
  if (!activeWebTabForMentions) {
    return (
      <PillBadge>
        <div className="tw-flex tw-items-center tw-gap-1">
          <Globe className="tw-size-3" />
          <TruncatedPillText
            content="activeWebTab"
            openBracket="{"
            closeBracket="}"
            tooltipContent={
              <div className="tw-text-left">
                Will use the active web tab at the time the message is sent
              </div>
            }
          />
        </div>
      </PillBadge>
    );
  }

  // Active web tab exists
  return (
    <PillBadge>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Globe className="tw-size-3" />
        <span className="tw-max-w-40 tw-truncate" title={activeWebTabForMentions.url}>
          {activeWebTabForMentions.title ?? "Untitled"}
        </span>
        <span className="tw-text-xs tw-text-faint">Current</span>
      </div>
    </PillBadge>
  );
}

/** Create an ActiveWebTabPillNode. */
export function $createActiveWebTabPillNode(): ActiveWebTabPillNode {
  return new ActiveWebTabPillNode();
}

/** Check if a node is an ActiveWebTabPillNode. */
export function $isActiveWebTabPillNode(
  node: LexicalNode | null | undefined
): node is ActiveWebTabPillNode {
  return node instanceof ActiveWebTabPillNode;
}

/**
 * Check whether the editor currently contains an active web tab pill.
 * Used to determine if Active Web Tab should be included at send time,
 * avoiding async pill-sync race conditions.
 * @returns True if at least one ActiveWebTabPillNode exists in the editor
 */
export function $hasActiveWebTabPill(): boolean {
  const root = $getRoot();

  function traverse(node: LexicalNode): boolean {
    if ($isActiveWebTabPillNode(node)) {
      return true;
    }

    if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = (node as { getChildren: () => LexicalNode[] }).getChildren();
      for (const child of children) {
        if (traverse(child)) {
          return true;
        }
      }
    }
    return false;
  }

  return traverse(root);
}

/**
 * Removes all active web tab pills from the editor.
 * @returns The number of pills removed
 */
export function $removeActiveWebTabPills(): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: LexicalNode): void {
    if ($isActiveWebTabPillNode(node)) {
      node.remove();
      removedCount++;
    } else if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = (node as { getChildren: () => LexicalNode[] }).getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return removedCount;
}
