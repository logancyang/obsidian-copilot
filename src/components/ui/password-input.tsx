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
  const [displayValue, setDisplayValue] = useState<string | number>("");
  const isFirstLoad = useRef(true);

  // Handle all value transformations in a single effect
  useEffect(() => {
    const processValue = async () => {
      // Decrypt the value only on first load if it's an encrypted string
      if (isFirstLoad.current && typeof value === "string" && value) {
        try {
          const decrypted = await getDecryptedKey(value);
          setDisplayValue(decrypted);
        } catch (error) {
          console.error("Failed to decrypt value:", error);
          setDisplayValue(value);
        }
        isFirstLoad.current = false;
      } else {
        // For subsequent updates or non-encrypted values, use the value directly
        setDisplayValue(value || "");
      }
    };

    processValue();
  }, [value]);

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
