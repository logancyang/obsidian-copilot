import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { XCircle, Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search...",
}) => {
  return (
    <div className="tw-relative">
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tw-pr-10" // Add padding to prevent text overlap with icons
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
