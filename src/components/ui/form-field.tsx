import React from "react";
import { Label } from "./label";

interface FormFieldProps {
  label: string | React.ReactNode;
  required?: boolean;
  error?: boolean;
  description?: string;
  errorMessage?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  error = false,
  description,
  errorMessage = "This field is required",
  children,
}) => {
  return (
    <div className="tw-space-y-2">
      <Label className={error ? "tw-text-error" : ""}>
        {label} {required && <span className="tw-text-error">*</span>}
      </Label>
      {description && <p className="tw-text-sm tw-text-muted">{description}</p>}
      {children}
      {error && <p className="tw-text-xs tw-text-error">{errorMessage}</p>}
    </div>
  );
};
