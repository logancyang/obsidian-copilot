/**
 * InputContainer - Standardized wrapper for chat input areas
 *
 * Provides consistent styling (rounded border, flex layout, padding)
 * for input components like ChatInput and DiscussInput.
 */

import React from "react";
import { cn } from "@/lib/utils";

interface InputContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function InputContainer({ children, className }: InputContainerProps) {
  return (
    <div
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-gap-0.5 tw-rounded-md",
        "tw-border tw-border-solid tw-border-border",
        "tw-px-1 tw-pb-1 tw-pt-2",
        className
      )}
    >
      {children}
    </div>
  );
}
