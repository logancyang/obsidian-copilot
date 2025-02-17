import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "mod-cta bg-interactive-accent text-on-accent shadow hover:bg-interactive-accent-hover",
        destructive: "bg-modifier-error text-normal shadow-sm hover:bg-modifier-error/90",
        secondary: "bg-secondary text-normal shadow-sm hover:bg-interactive-hover",
        ghost: "clickable-icon bg-transparent hover:bg-interactive-accent hover:text-on-accent",
        link: "text-accent underline-offset-4 hover:underline",
        ghost2:
          "text-faint clickable-icon bg-transparent hover:bg-opacity-100 hover:text-normal hover:bg-transparent outline-none focus-visible:outline-none focus-visible:text-normal focus-visible:ring-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-6 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "size-7",
        fit: "px-1 text-xs gap-1",
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
