import * as React from "react";
import { format } from "date-fns";
import { DayPicker } from "react-day-picker";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * DatePicker component with popover calendar UI
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (date: Date | undefined) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          disabled={disabled}
          className={cn(
            "tw-w-full tw-justify-start tw-text-left tw-font-normal",
            !value && "tw-text-muted",
            className
          )}
        >
          <CalendarIcon className="tw-mr-2 tw-size-4" />
          {value ? format(value, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="tw-w-auto tw-p-0" align="start">
        <DayPicker
          mode="single"
          selected={value}
          onSelect={handleSelect}
          initialFocus
          classNames={{
            months:
              "tw-flex tw-flex-col sm:tw-flex-row tw-space-y-4 sm:tw-space-x-4 sm:tw-space-y-0",
            month: "tw-space-y-4",
            caption: "tw-flex tw-justify-center tw-pt-1 tw-relative tw-items-center",
            caption_label: "tw-text-sm tw-font-medium",
            nav: "tw-space-x-1 tw-flex tw-items-center",
            nav_button:
              "tw-size-7 tw-bg-transparent tw-p-0 tw-opacity-50 hover:tw-opacity-100 tw-inline-flex tw-items-center tw-justify-center tw-rounded-md",
            nav_button_previous: "tw-absolute tw-left-1",
            nav_button_next: "tw-absolute tw-right-1",
            table: "tw-w-full tw-border-collapse tw-space-y-1",
            head_row: "tw-flex",
            head_cell: "tw-text-muted tw-rounded-md tw-w-8 tw-font-normal tw-text-[0.8rem]",
            row: "tw-flex tw-w-full tw-mt-2",
            cell: cn(
              "tw-relative tw-p-0 tw-text-center tw-text-sm focus-within:tw-relative focus-within:tw-z-[20] [&:has([aria-selected])]:tw-rounded-md [&:has([aria-selected])]:tw-bg-interactive-accent",
              "[&:has([aria-selected].day-outside)]:tw-bg-interactive-accent/50"
            ),
            day: cn(
              "tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-md tw-p-0 tw-font-normal hover:tw-bg-modifier-hover aria-selected:tw-opacity-100"
            ),
            day_range_end: "day-range-end",
            day_selected:
              "tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover hover:tw-text-on-accent focus:tw-bg-interactive-accent focus:tw-text-on-accent",
            day_today: "tw-bg-secondary tw-text-normal",
            day_outside:
              "day-outside tw-text-muted tw-opacity-50 aria-selected:tw-bg-interactive-accent/50 aria-selected:tw-text-muted aria-selected:tw-opacity-30",
            day_disabled: "tw-text-muted tw-opacity-50",
            day_range_middle:
              "aria-selected:tw-bg-interactive-accent aria-selected:tw-text-on-accent",
            day_hidden: "tw-invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
