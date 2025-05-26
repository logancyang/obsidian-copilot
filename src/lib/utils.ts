import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const customTwMerge = extendTailwindMerge({
  prefix: "tw-",
  extend: {
    classGroups: {
      "text-color": ["text-muted", "text-success", "text-warning", "text-error", "text-accent"],
      "font-size": [
        "text-smallest",
        "text-smaller",
        "text-small",
        "text-ui-smaller",
        "text-ui-small",
        "text-ui-medium",
        "text-ui-larger",
      ],
    },
  },
});
export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
