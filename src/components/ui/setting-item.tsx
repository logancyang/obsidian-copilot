import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useTab } from "@/contexts/TabContext";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SettingSlider } from "@/components/ui/setting-slider";
import { debounce } from "@/utils";

// 定义输入控件的类型
type InputType =
  | "text"
  | "password"
  | "number"
  | "textarea"
  | "switch"
  | "select"
  | "custom"
  | "slider"
  | "dialog";

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
}

// 添加 Dialog 类型的 Props
interface DialogSettingItemProps extends BaseSettingItemProps {
  type: "dialog";
  dialogTitle?: string;
  dialogDescription?: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}

// 联合类型
type SettingItemProps =
  | TextSettingItemProps
  | TextareaSettingItemProps
  | SwitchSettingItemProps
  | SelectSettingItemProps
  | CustomSettingItemProps
  | SliderSettingItemProps
  | DialogSettingItemProps;

export function SettingItem(props: SettingItemProps) {
  const { title, description, className, disabled } = props;
  const { modalContainer } = useTab();

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
            className="tw-w-full sm:tw-w-[200px]"
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
            className="tw-w-full sm:tw-w-[200px]"
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
            className="tw-min-h-[80px] tw-w-full sm:tw-w-[300px]"
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
          <div className="tw-group tw-relative tw-w-full sm:tw-w-[200px]">
            <select
              value={props.value?.toString()}
              onChange={(e) => props.onChange?.(e.target.value)}
              disabled={disabled}
              className={cn(
                "tw-w-full tw-appearance-none",
                "tw-flex tw-h-9 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8",
                "tw-text-sm !tw-shadow tw-transition-colors",
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
            disabled={disabled}
            className="tw-w-full sm:tw-w-[300px]"
          />
        );

      case "dialog":
        return (
          <Dialog>
            <DialogTrigger asChild>{props.trigger}</DialogTrigger>
            <DialogContent container={modalContainer}>
              {(props.dialogTitle || props.dialogDescription) && (
                <DialogHeader>
                  {props.dialogTitle && <DialogTitle>{props.dialogTitle}</DialogTitle>}
                  {props.dialogDescription && (
                    <DialogDescription>{props.dialogDescription}</DialogDescription>
                  )}
                </DialogHeader>
              )}
              {props.children}
            </DialogContent>
          </Dialog>
        );

      case "custom":
        return props.children;
    }
  };

  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-items-start tw-justify-between tw-gap-4 tw-py-4 sm:tw-flex-row sm:tw-items-center",
        "tw-w-full",
        className
      )}
    >
      <div className="tw-w-full tw-space-y-1.5 sm:tw-w-[300px]">
        <div className="tw-text-sm tw-font-medium tw-leading-none">{title}</div>
        {description && <div className="tw-text-xs tw-text-muted">{description}</div>}
      </div>
      <div className="tw-w-full tw-flex-1 sm:tw-flex sm:tw-justify-end">{renderControl()}</div>
    </div>
  );
}
