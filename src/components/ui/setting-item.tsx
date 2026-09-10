import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ChevronDown } from "lucide-react";
import { SettingSlider } from "@/components/ui/setting-slider";
import { debounce } from "@/lib/debounce";

// 定义输入控件的类型
type InputType =
  | "text"
  | "password"
  | "number"
  | "textarea"
  | "switch"
  | "select"
  | "custom"
  | "slider";

// Select选项的类型
interface SelectOption {
  label: string;
  value: string | number;
}

// 基础Props
interface BaseSettingItemProps {
  type: InputType;
  title: string;
  description?: string | React.ReactNode;
  className?: string;
  disabled?: boolean;
}

// 不同类型输入控件的Props
interface TextSettingItemProps extends BaseSettingItemProps {
  type: "text" | "password" | "number";
  value?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
}

interface TextareaSettingItemProps extends BaseSettingItemProps {
  type: "textarea";
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

interface SwitchSettingItemProps extends BaseSettingItemProps {
  type: "switch";
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

interface SelectSettingItemProps extends BaseSettingItemProps {
  type: "select";
  value?: string | number;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

interface CustomSettingItemProps extends BaseSettingItemProps {
  type: "custom";
  children: React.ReactNode;
}

// 添加 Slider 类型的 Props
interface SliderSettingItemProps extends BaseSettingItemProps {
  type: "slider";
  value?: number;
  onChange?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

// 联合类型
type SettingItemProps =
  | TextSettingItemProps
  | TextareaSettingItemProps
  | SwitchSettingItemProps
  | SelectSettingItemProps
  | CustomSettingItemProps
  | SliderSettingItemProps;

export function SettingItem(props: SettingItemProps) {
  const { title, description, className, disabled } = props;

  const onChange: ((value: string | number) => void) | undefined =
    "onChange" in props ? props.onChange : undefined;
  const debouncedOnChange = useMemo(() => {
    if (!onChange) return;
    return debounce((value: string | number) => {
      onChange(value);
    }, 1000);
  }, [onChange]);

  const renderControl = () => {
    switch (props.type) {
      case "text":
      case "number":
        return (
          <Input
            type={props.type}
            defaultValue={props.value}
            onChange={(e) => {
              debouncedOnChange?.(e.target.value);
            }}
            placeholder={props.placeholder}
            disabled={disabled}
            className="tw-w-full @lg/setting-row:tw-w-[200px]"
          />
        );

      case "password":
        return (
          <PasswordInput
            value={props.value !== undefined ? String(props.value) : undefined}
            onChange={(value) => {
              debouncedOnChange?.(value);
            }}
            placeholder={props.placeholder}
            disabled={disabled}
            className="tw-w-full @lg/setting-row:tw-w-[200px]"
          />
        );

      case "textarea":
        return (
          <Textarea
            defaultValue={props.value}
            onChange={(e) => {
              debouncedOnChange?.(e.target.value);
            }}
            placeholder={props.placeholder}
            rows={props.rows || 3}
            disabled={disabled}
            className="tw-min-h-[80px] tw-w-full @lg/setting-row:tw-w-[300px]"
          />
        );

      case "switch":
        return (
          <SettingSwitch
            checked={props.checked}
            onCheckedChange={props.onCheckedChange}
            disabled={disabled}
          />
        );

      case "select":
        return (
          <div className="tw-group tw-relative tw-w-full @lg/setting-row:tw-w-[200px]">
            <select
              value={props.value?.toString()}
              onChange={(e) => props.onChange?.(e.target.value)}
              disabled={disabled}
              className={cn(
                "tw-w-full tw-appearance-none",
                "tw-flex tw-h-9 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8",
                // `tw-text-left` overrides Obsidian's macOS settings default
                // (`--dropdown-text-align: end` applied to bare `select`), which
                // strands the label against the right edge of our fixed-width
                // control. A plain class wins on specificity — neither rule is
                // `!important`, and a class outranks an element selector.
                "tw-text-left tw-text-sm !tw-shadow tw-transition-colors",
                "focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring",
                "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
                "hover:tw-bg-interactive-hover hover:tw-text-normal"
              )}
            >
              {props.placeholder && (
                <option value="" disabled>
                  {props.placeholder}
                </option>
              )}
              {props.options.map((option) => (
                <option key={option.value} value={option.value.toString()}>
                  {option.label}
                </option>
              ))}
            </select>
            <div
              className={cn(
                "tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-pr-2",
                "tw-transition-colors group-hover:[&>svg]:tw-text-normal",
                disabled && "tw-opacity-50"
              )}
            >
              <ChevronDown className="tw-size-4" />
            </div>
          </div>
        );

      case "slider":
        return (
          <SettingSlider
            value={props.value || 0}
            onChange={props.onChange}
            min={props.min}
            max={props.max}
            step={props.step}
            suffix={props.suffix}
            disabled={disabled}
            className="tw-w-full @lg/setting-row:tw-w-[300px]"
          />
        );

      case "custom":
        return props.children;
    }
  };

  // Settings panes can be narrow inside a wide window, so rows respond to their
  // own available width. https://github.com/Brevilabs/obsidian-copilot-private/issues/404
  return (
    <div className={cn("tw-w-full tw-min-w-0 tw-py-4 tw-@container/setting-row", className)}>
      <div className="tw-grid tw-grid-cols-1 tw-items-start tw-gap-4 @lg/setting-row:tw-grid-cols-[minmax(0,1fr)_auto] @lg/setting-row:tw-items-center">
        <div className="tw-min-w-0 tw-space-y-1.5 tw-break-words">
          <div className="tw-text-sm tw-font-medium tw-leading-tight">{title}</div>
          {description && <div className="tw-text-xs tw-text-muted">{description}</div>}
        </div>
        <div className="tw-flex tw-w-full tw-min-w-0 tw-justify-start @lg/setting-row:tw-w-auto @lg/setting-row:tw-justify-end">
          {renderControl()}
        </div>
      </div>
    </div>
  );
}
