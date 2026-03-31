import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { getDecryptedKey, isEncryptedValue } from "@/encryptionService";
import { logError } from "@/logger";
import { err2String } from "@/utils";

export function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  autoDecrypt = true,
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** When false, skip auto-decryption of encrypted values. Use for passphrase inputs. */
  autoDecrypt?: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Reason: tracks user edits so stale async decrypt results are discarded.
  // Incremented on every onChange; checked after await to avoid overwriting.
  const editVersionRef = useRef(0);

  // Reason: useEffect cleanup sets `cancelled = true` whenever `value` changes
  // or the component unmounts, preventing stale async decrypt results from
  // overwriting the input or calling setState after unmount.
  useEffect(() => {
    let cancelled = false;

    const processValue = async () => {
      const inputEl = inputRef.current;
      if (!inputEl) return;
      const versionAtStart = editVersionRef.current;

      // Reason: decrypt whenever the incoming value looks encrypted, not only
      // on first load — this handles settings import, rollback, and cross-
      // component updates that may swap in an encrypted value mid-mount.
      if (autoDecrypt && value && isEncryptedValue(value)) {
        try {
          const decrypted = await getDecryptedKey(value);
          if (cancelled || editVersionRef.current !== versionAtStart) return;
          // Reason: an encrypted value that decrypts to "" means the current
          // device cannot decrypt it. Show an error instead of ciphertext.
          if (!decrypted) {
            inputEl.value = "";
            setDecryptionFailed(true);
          } else {
            inputEl.value = decrypted;
            setDecryptionFailed(false);
          }
        } catch (error) {
          if (cancelled || editVersionRef.current !== versionAtStart) return;
          logError("Failed to decrypt value:" + err2String(error));
          inputEl.value = "";
          setDecryptionFailed(true);
        }
      } else {
        inputEl.value = value || "";
        setDecryptionFailed(false);
      }
    };

    processValue();

    return () => {
      cancelled = true;
    };
  }, [value, autoDecrypt]);

  return (
    <div className={cn("tw-relative", className)}>
      <Input
        ref={inputRef}
        type={showPassword ? "text" : "password"}
        onChange={(e) => {
          editVersionRef.current += 1;
          onChange?.(e.target.value);
        }}
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
      {decryptionFailed && (
        <p className="tw-mt-1 tw-text-xs tw-text-error">
          Unable to decrypt this key on the current device. Please re-enter the key.
        </p>
      )}
    </div>
  );
}
