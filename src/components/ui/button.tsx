import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
<<<<<<< HEAD
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
=======
  "tw-inline-flex tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-rounded-md tw-text-sm tw-font-medium tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-pointer-events-none disabled:tw-opacity-50 [&_svg]:tw-shrink-0",
>>>>>>> 0035c48 (More classname fixes)
  {
    variants: {
      variant: {
        default:
<<<<<<< HEAD
          "mod-cta bg-interactive-accent text-on-accent shadow hover:bg-interactive-accent-hover",
        destructive:
          "clickable-icon bg-modifier-error text-on-accent hover:bg-modifier-error hover:text-on-accent",
        secondary: "bg-secondary text-normal shadow-sm hover:bg-interactive-hover",
        ghost: "clickable-icon bg-transparent hover:bg-interactive-accent hover:text-on-accent",
        link: "text-accent underline-offset-4 hover:underline",
        success:
          "clickable-icon bg-modifier-success text-on-accent hover:bg-modifier-success hover:text-on-accent",
=======
          "mod-cta tw-bg-interactive-accent tw-text-on-accent tw-shadow hover:tw-bg-interactive-accent-hover",
        destructive:
          "tw-bg-modifier-error tw-text-normal tw-shadow-sm hover:tw-bg-modifier-error/90",
        secondary: "tw-bg-secondary tw-text-normal tw-shadow-sm hover:tw-bg-interactive-hover",
        ghost:
          "clickable-icon tw-bg-transparent hover:tw-bg-interactive-accent hover:tw-text-on-accent",
        link: "tw-text-accent tw-underline-offset-4 hover:tw-underline",
>>>>>>> 0035c48 (More classname fixes)
        ghost2:
          "clickable-icon tw-bg-transparent tw-text-faint tw-outline-none hover:tw-bg-transparent hover:tw-bg-opacity-100 hover:tw-text-normal focus-visible:tw-text-normal focus-visible:tw-outline-none focus-visible:tw-ring-0",
      },
      size: {
        default: "tw-h-9 tw-px-4 tw-py-2",
        sm: "tw-h-6 tw-rounded-md tw-px-3 tw-text-xs",
        lg: "tw-h-10 tw-rounded-md tw-px-8",
        icon: "tw-size-7",
        fit: "tw-gap-1 tw-px-1 tw-text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
