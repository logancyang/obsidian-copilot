import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { getDecryptedKey, hasEncryptionPrefix } from "@/encryptionService";
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
  // Reason: only attempt decryption on the very first mount of a non-empty
  // value. After that, simply mirror the prop into the DOM so a user typing a
  // plaintext key that happens to start with `enc_` / `enc_web_` / `enc_desk_`
  // is never re-interpreted as ciphertext and silently cleared. Matches
  // master's pre-PR behavior (`isFirstLoad` ref), with the failure UX added.
  const isFirstLoadRef = useRef(true);

  // Reason: useEffect cleanup sets `cancelled = true` whenever `value` changes
  // or the component unmounts, preventing stale async decrypt results from
  // overwriting the input or calling setState after unmount.
  useEffect(() => {
    let cancelled = false;

    const processValue = async () => {
      const inputEl = inputRef.current;
      if (!inputEl) return;

      // Reason: only the first non-empty mount can be a legacy encrypted
      // value from settings. Subsequent prop updates are echoes of user
      // edits (or external resets to plaintext) and must NEVER trigger
      // decryption — see the regression flagged in PR review (a plaintext
      // value starting with `enc_` would otherwise be cleared).
      const isInitialEncryptedValue =
        isFirstLoadRef.current && autoDecrypt && value && hasEncryptionPrefix(value);

      if (isInitialEncryptedValue) {
        try {
          const decrypted = await getDecryptedKey(value);
          if (cancelled) return;
          // Reason: an encrypted value that decrypts to "" means the current
          // device cannot decrypt it. Show an error instead of ciphertext so
          // the user knows to re-enter the key.
          if (!decrypted) {
            inputEl.value = "";
            setDecryptionFailed(true);
          } else {
            inputEl.value = decrypted;
            setDecryptionFailed(false);
          }
        } catch (error) {
          if (cancelled) return;
          logError("Failed to decrypt value:" + err2String(error));
          inputEl.value = "";
          setDecryptionFailed(true);
        }
        isFirstLoadRef.current = false;
      } else {
        inputEl.value = value || "";
        setDecryptionFailed(false);
        // Reason: lock out future decryption attempts as soon as we have
        // ever rendered a non-encrypted (or empty) value. Without this an
        // initial empty render followed by a paste of `enc_*`-prefixed
        // plaintext would still get decrypted.
        if (value !== undefined) isFirstLoadRef.current = false;
      }
    };

    void processValue();

    return () => {
      cancelled = true;
    };
  }, [value, autoDecrypt]);

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
      {decryptionFailed && (
        <p className="tw-mt-1 tw-text-xs tw-text-error">
          Unable to decrypt this key on the current device. Please re-enter the key.
        </p>
      )}
    </div>
  );
}
