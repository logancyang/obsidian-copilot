import { cn } from "@/lib/utils";
import React from "react";

export const BareButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "tw-h-auto tw-cursor-pointer tw-border-0 tw-p-0 tw-text-left tw-font-[inherit]",
      "!tw-bg-transparent !tw-shadow-none",
      className
    )}
    {...props}
  />
));

BareButton.displayName = "BareButton";
