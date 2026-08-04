import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "tw-inline-flex tw-items-center tw-rounded-md tw-px-2.5 tw-py-0.5 tw-text-ui-smaller tw-text-normal tw-transition-colors focus:tw-outline-none",
  {
    variants: {
      variant: {
        default: "tw-bg-primary-alt tw-shadow",
        secondary: "tw-bg-secondary-alt",
        destructive: "tw-bg-modifier-error tw-text-on-accent tw-shadow",
        outline: "tw-border tw-border-solid tw-border-border",
        success: "tw-bg-success tw-text-success",
        accent: "tw-bg-interactive-accent tw-text-on-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);

Badge.displayName = "Badge";

export { Badge, badgeVariants };
