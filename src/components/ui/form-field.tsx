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
    <div className="space-y-2">
      <Label className={error ? "text-error" : ""}>
        {label} {required && <span className="text-error">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-error">{errorMessage}</p>}
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
  );
};
