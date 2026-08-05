import React from "react";
import type { CustomModel } from "@/aiParams";
import { getProviderLabel } from "@/lib/model-display-utils";
import { EyeOff } from "lucide-react";
import { ModelCapability } from "@/constants";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface ModelDisplayProps {
  model: CustomModel;
  iconSize?: number;
}

interface ModelCapabilityIconsProps {
  capabilities?: ModelCapability[];
  iconSize?: number;
}

const NO_VISION_LABEL = "This model does not support image inputs.";

/**
 * Whether {@link ModelCapabilityIcons} would render the eye-off. Drives the
 * surrounding wrapper so it never renders empty (a vision-capable model shows no
 * icon) and never hides the eye-off for a model known to lack vision (`[]`).
 */
export function hasCapabilityIcons(capabilities: ModelCapability[] | undefined): boolean {
  if (capabilities === undefined) return false;
  return !capabilities.includes(ModelCapability.VISION);
}

/**
 * We badge only the exception, not the norm. `undefined` means "unknown" (no
 * modality snapshot — e.g. an agent-provided model) and renders nothing; we never
 * assert a missing capability we don't actually know about. A defined array is
 * "known": flag the absence of vision with a muted eye-off. Vision and reasoning
 * themselves render nothing — they're ubiquitous on modern models, so the only
 * signal we surface is the warning that a model can't take images.
 */
export const ModelCapabilityIcons: React.FC<ModelCapabilityIconsProps> = ({
  capabilities,
  iconSize = 16,
}) => {
  if (capabilities === undefined) return null;
  if (capabilities.includes(ModelCapability.VISION)) return null;
  return (
    <HelpTooltip content={NO_VISION_LABEL} side="top">
      <EyeOff
        className="tw-text-muted"
        style={{ width: iconSize, height: iconSize }}
        data-testid="model-cap-no-vision"
      />
    </HelpTooltip>
  );
};

export const ModelDisplay: React.FC<ModelDisplayProps> = ({ model, iconSize = 14 }) => {
  const displayName = model.displayName || model.name;
  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
      <span className="tw-truncate tw-text-sm hover:tw-text-normal">{displayName}</span>
      {hasCapabilityIcons(model.capabilities) && (
        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
          <ModelCapabilityIcons capabilities={model.capabilities} iconSize={iconSize} />
        </div>
      )}
    </div>
  );
};

export const getModelDisplayText = (model: CustomModel): string => {
  const displayName = model.displayName || model.name;
  const provider = `(${getProviderLabel(model.provider)})`;
  return `${displayName} ${provider}`;
};

export const getModelDisplayWithIcons = (model: CustomModel): string => {
  const displayName = model.displayName || model.name;
  const provider = `(${getProviderLabel(model.provider, model)})`;
  return `${displayName} ${provider}`;
};
