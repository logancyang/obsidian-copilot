import React, { useState, useEffect, useRef } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const isFirstLoad = useRef(true);

  // Initialize the input value on first load
  useEffect(() => {
    const processValue = async () => {
      if (isFirstLoad.current && typeof value === "string" && value && inputRef.current) {
        try {
          const decrypted = await getDecryptedKey(value);
          inputRef.current.value = decrypted;
        } catch (error) {
          console.error("Failed to decrypt value:", error);
          inputRef.current.value = value;
        }
        isFirstLoad.current = false;
      }
    };

    processValue();
  }, [value]);

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        type={showPassword ? "text" : "password"}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("![padding-right:1.75rem] w-full")}
      />
      <div
        onClick={() => !disabled && setShowPassword(!showPassword)}
        className={cn(
          "absolute right-2 top-0 bottom-0 flex items-center justify-center",
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
