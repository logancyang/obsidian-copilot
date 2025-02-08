import React from "react";
import { CustomModel } from "@/aiParams";
import { getProviderLabel } from "@/utils";
import { Lightbulb, Eye, Globe } from "lucide-react";
import { ModelCapability } from "@/constants";

interface ModelDisplayProps {
  model: CustomModel;
  iconSize?: number;
}

interface ModelCapabilityIconsProps {
  capabilities?: ModelCapability[];
  iconSize?: number;
}

export const ModelCapabilityIcons: React.FC<ModelCapabilityIconsProps> = ({
  capabilities = [],
  iconSize = 16,
}) => {
  return (
    <>
      {capabilities.map((cap, index) => {
        switch (cap) {
          case ModelCapability.REASONING:
            return (
              <Lightbulb
                key={index}
                className="text-model-capabilities-blue"
                style={{ width: iconSize, height: iconSize }}
              />
            );
          case ModelCapability.VISION:
            return (
              <Eye
                key={index}
                className="text-model-capabilities-green"
                style={{ width: iconSize, height: iconSize }}
              />
            );
          case ModelCapability.WEB_SEARCH:
            return (
              <Globe
                key={index}
                className="text-model-capabilities-blue"
                style={{ width: iconSize, height: iconSize }}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
};

export const ModelDisplay: React.FC<ModelDisplayProps> = ({ model, iconSize = 14 }) => {
  const displayName = model.displayName || model.name;
  const provider = `(${getProviderLabel(model.provider)})`;

  return (
    <div className="flex items-center gap-1">
      <span>
        {displayName}
        <span className="text-[10px]">{provider}</span>
      </span>
      {model.capabilities && model.capabilities.length > 0 && (
        <div className="flex gap-0.5 items-center">
          <ModelCapabilityIcons capabilities={model.capabilities} iconSize={iconSize} />
        </div>
      )}
    </div>
  );
};

export const getModelDisplayText = (model: CustomModel): string => {
  const displayName = model.displayName || model.name;
  const provider = `(${getProviderLabel(model.provider)})`;
  return `${displayName}${provider}`;
};

export const getModelDisplayWithIcons = (model: CustomModel): string => {
  const displayName = model.displayName || model.name;
  const provider = `(${getProviderLabel(model.provider, model)})`;
  const icons =
    model.capabilities
      ?.map((cap) => {
        switch (cap) {
          case ModelCapability.REASONING:
            return "Reasoning";
          case ModelCapability.VISION:
            return "Vision";
          case ModelCapability.WEB_SEARCH:
            return "Websearch";
          default:
            return "";
        }
      })
      .join("|") || "";
  return `${displayName}${provider} ${icons}`;
};
