import React from "react";
import { Label } from "./label";

interface FormFieldProps {
  label?: string | React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: boolean;
  description?: string;
  errorMessage?: string;
  errorMessageId?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  required = false,
  error = false,
  description,
  errorMessage = "This field is required",
  errorMessageId,
  children,
}) => {
  return (
    <div className="tw-space-y-2">
      {label && (
        <Label htmlFor={htmlFor} className={error ? "tw-text-error" : ""}>
          {label}{" "}
          {required && (
            <>
              <span className="tw-text-error" aria-hidden="true">
                *
              </span>
              <span className="tw-sr-only"> (required)</span>
            </>
          )}
        </Label>
      )}
      {description && <p className="tw-text-sm tw-text-muted">{description}</p>}
      {children}
      {error && (
        <p id={errorMessageId} role="alert" className="tw-text-xs tw-text-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
