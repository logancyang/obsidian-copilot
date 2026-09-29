import { cn } from "@/lib/utils";
import type { UrlKind } from "@/utils/urlTagUtils";
import { Globe, SquarePlay } from "lucide-react";
import * as React from "react";

export function UrlTypeIcon({ type, className }: { type: UrlKind; className?: string }) {
  return type === "youtube" ? (
    <SquarePlay className={cn("tw-text-error", className)} />
  ) : (
    <Globe className={cn("tw-text-context-manager-cyan", className)} />
  );
}
