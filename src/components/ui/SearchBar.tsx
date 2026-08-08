import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { XCircle, Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Extra classes for the inner Input — e.g. a height override (`!tw-h-7`) for
   * compact list contexts. The Input's base height is `!`-important, so an
   * override must be `!`-important too (cn/tailwind-merge resolves the conflict).
   */
  inputClassName?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search...",
  inputClassName,
}) => {
  return (
    <div className="tw-relative">
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // tw-pr-10 prevents text overlap with the trailing icons
        className={cn("tw-pr-10", inputClassName)}
      />
      {value && (
        <Button
          variant={"secondary"}
          onClick={() => onChange("")}
          className="tw-absolute tw-right-8 tw-top-1/2 tw-size-4 -tw-translate-y-1/2 tw-transform tw-rounded-full tw-p-0 tw-transition-colors"
          aria-label="Clear search"
        >
          <XCircle className="tw-size-4 tw-text-muted/60 hover:tw-text-accent-hover" />
        </Button>
      )}
      <Search className="tw-absolute tw-right-3 tw-top-1/2 tw-size-4 -tw-translate-y-1/2 tw-transform tw-text-muted" />
    </div>
  );
};
