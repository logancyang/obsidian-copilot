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

function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

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
            className="w-full sm:w-[200px]"
          />
        );

      case "password":
        return (
          <PasswordInput
            value={props.value}
            onChange={(value) => {
              debouncedOnChange?.(value);
            }}
            placeholder={props.placeholder}
            disabled={disabled}
            className="w-full sm:w-[200px]"
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
            className="w-full sm:w-[300px] min-h-[80px]"
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
          <div className="relative w-full sm:w-[200px] group">
            <select
              value={props.value?.toString()}
              onChange={(e) => props.onChange?.(e.target.value)}
              disabled={disabled}
              className={cn(
                "w-full appearance-none",
                "flex h-9 rounded-md border border-solid border-border bg-dropdown px-3 py-1 pr-8",
                "text-sm !shadow transition-colors",
                "focus:outline-none focus:ring-1 focus:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "hover:bg-interactive-accent hover:text-on-accent"
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
                "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2",
                "transition-colors group-hover:[&>svg]:text-on-accent",
                disabled && "opacity-50"
              )}
            >
              <ChevronDown className="h-4 w-4" />
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
            className="w-full sm:w-[300px]"
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
        "flex flex-col sm:flex-row items-start sm:items-center justify-between py-4 gap-4",
        "w-full",
        className
      )}
    >
      <div className="space-y-1.5 w-full sm:w-[300px]">
        <div className="text-sm font-medium leading-none">{title}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </div>
      <div className="flex-1 w-full sm:flex sm:justify-end">{renderControl()}</div>
    </div>
  );
}
