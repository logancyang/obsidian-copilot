import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { getValidEmbeddingDimensions } from "@/utils/embeddingDimensions";
import React, { useEffect, useMemo, useState } from "react";

interface EmbeddingDimensionsFieldProps {
  dimensions?: number;
  onChange: (dimensions: number | undefined) => void;
  onValidityChange?: (isValid: boolean) => void;
}

/**
 * Collects an optional provider-supported embedding output dimension.
 *
 * Invalid text remains local so model settings are never updated with an
 * unsupported value while the user corrects the field.
 */
export const EmbeddingDimensionsField: React.FC<EmbeddingDimensionsFieldProps> = ({
  dimensions,
  onChange,
  onValidityChange,
}) => {
  const [inputValue, setInputValue] = useState(() => dimensions?.toString() ?? "");
  const validDimensions = useMemo(
    () => getValidEmbeddingDimensions(Number(inputValue)),
    [inputValue]
  );
  const isValid = inputValue === "" || validDimensions !== undefined;

  useEffect(() => {
    // Keep the local invalid-input buffer in sync when the parent loads a different model.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    setInputValue(dimensions?.toString() ?? "");
  }, [dimensions]);

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  /** Publishes only a valid dimension or an explicit provider-default reset. */
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInputValue(value);

    if (value === "") {
      onChange(undefined);
      return;
    }

    const nextDimensions = getValidEmbeddingDimensions(Number(value));
    if (nextDimensions !== undefined) {
      onChange(nextDimensions);
    }
  };

  return (
    <FormField
      label="Embedding dimensions"
      description="Optional output vector dimensions. Leave empty to use the provider default. Changing the model or dimensions requires rebuilding the vault index."
      error={!isValid}
      errorMessage="Embedding dimensions must be a positive integer"
    >
      <Input
        type="number"
        aria-label="Embedding dimensions"
        min={1}
        step={1}
        placeholder="Provider default, e.g. 512"
        value={inputValue}
        onChange={handleChange}
      />
    </FormField>
  );
};
