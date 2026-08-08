import { cn } from "@/lib/utils";
import type { UrlKind } from "@/utils/urlTagUtils";
import { Globe, Youtube } from "lucide-react";
import * as React from "react";

/**
 * Canonical glyph + theme color for a context URL's type, shared across every
 * URL surface (the +URL popover, the Manage Links panel, the context chips) so
 * they can't drift apart: web → cyan globe, YouTube → red play.
 */
export function UrlTypeIcon({ type, className }: { type: UrlKind; className?: string }) {
  return type === "youtube" ? (
    <Youtube className={cn("tw-text-error", className)} />
  ) : (
    <Globe className={cn("tw-text-context-manager-cyan", className)} />
  );
}
