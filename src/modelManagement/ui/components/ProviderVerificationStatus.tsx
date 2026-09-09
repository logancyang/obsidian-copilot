import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { Loader2 } from "lucide-react";
import React from "react";

export interface ProviderVerificationStatusProps {
  /** Latest result for the current provider configuration; absent while checking. */
  result?: VerificationResult;
}

export function ProviderVerificationStatus({ result }: ProviderVerificationStatusProps) {
  // https://github.com/logancyang/obsidian-copilot/issues/3147:
  // Only a fresh successful probe earns a success badge. Connection failures
  // remain inconclusive rather than accusing a valid key of being invalid.
  const label = !result
    ? "Checking…"
    : result.ok
      ? "Verified"
      : result.code === "missing_api_key"
        ? "No key"
        : result.code === "invalid_api_key"
          ? "Invalid key"
          : "Check failed";
  return (
    <Badge
      variant={result && !result.ok ? "destructive" : "secondary"}
      title={result?.message}
      className={cn("tw-shrink-0 tw-rounded-full", result?.ok && "tw-bg-success tw-text-success")}
    >
      {label}
    </Badge>
  );
}

export interface ProviderVerificationProgressProps {
  pending: number;
}

export function ProviderVerificationProgress({ pending }: ProviderVerificationProgressProps) {
  // https://github.com/logancyang/obsidian-copilot/issues/3147:
  // Keep progress outside document flow so the provider list does not jump.
  if (pending === 0) return null;
  return (
    <div
      role="status"
      className="tw-pointer-events-none tw-absolute tw-right-0 tw-top-0 tw-flex -tw-translate-y-1/2 tw-items-center tw-gap-1.5 tw-rounded-full tw-bg-primary tw-px-2 tw-py-1 tw-text-xs tw-text-muted tw-shadow-sm"
    >
      <Loader2 className="tw-size-3 tw-animate-spin" aria-hidden="true" />
      Verifying providers…
    </div>
  );
}
