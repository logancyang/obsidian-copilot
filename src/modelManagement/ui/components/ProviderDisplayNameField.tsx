import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import React from "react";

export interface ProviderDisplayNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  errorMessage?: string | null;
}

export const ProviderDisplayNameField: React.FC<ProviderDisplayNameFieldProps> = ({
  value,
  onChange,
  errorMessage,
}) => {
  const inputId = React.useId();
  const errorMessageId = `${inputId}-error`;
  const hasError = errorMessage != null;

  return (
    <FormField
      label="Display name"
      htmlFor={inputId}
      required
      error={hasError}
      errorMessage={errorMessage ?? undefined}
      errorMessageId={errorMessageId}
    >
      <Input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        aria-invalid={hasError}
        aria-describedby={hasError ? errorMessageId : undefined}
        aria-errormessage={hasError ? errorMessageId : undefined}
      />
    </FormField>
  );
};
