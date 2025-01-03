import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { getDecryptedKey } from "@/encryptionService";

export function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);

  // 获取要显示的值
  const displayValue = typeof value === "string" && value ? getDecryptedKey(value) : value;

  return (
    <div className={cn("relative", className)}>
      <Input
        type={showPassword ? "text" : "password"}
        value={displayValue}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("![padding-right:1.75rem] w-full")}
      />
      <div
        onClick={() => !disabled && setShowPassword(!showPassword)}
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2",
          "cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        role="button"
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? (
          <EyeOff
            className={cn(
              "h-3.5 w-3.5",
              "text-muted/60 hover:text-accent",
              "transition-colors duration-200"
            )}
          />
        ) : (
          <Eye
            className={cn(
              "h-3.5 w-3.5",
              "text-muted/60 hover:text-accent",
              "transition-colors duration-200"
            )}
          />
        )}
      </div>
    </div>
  );
}
