import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = value ?? "";
  }, [value]);

  return (
    <div className={cn("tw-relative", className)}>
      <Input
        ref={inputRef}
        type={showPassword ? "text" : "password"}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("tw-w-full !tw-pr-7")}
      />
      <div
        onClick={() => !disabled && setShowPassword(!showPassword)}
        className={cn(
          "tw-absolute tw-inset-y-0 tw-right-2 tw-flex tw-items-center tw-justify-center",
          "tw-cursor-pointer",
          disabled && "tw-cursor-not-allowed tw-opacity-50"
        )}
        role="button"
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? (
          <EyeOff
            className={cn(
              "tw-size-3.5",
              "tw-text-muted/60 hover:tw-text-accent",
              "tw-transition-colors tw-duration-200"
            )}
          />
        ) : (
          <Eye
            className={cn(
              "tw-size-3.5",
              "tw-text-muted/60 hover:tw-text-accent",
              "tw-transition-colors tw-duration-200"
            )}
          />
        )}
      </div>
    </div>
  );
}
