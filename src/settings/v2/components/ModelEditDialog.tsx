import React, { useEffect, useState } from "react";
import { useTab } from "@/contexts/TabContext";
import { CustomModel } from "@/aiParams";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpCircle } from "lucide-react";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FormField } from "@/components/ui/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MODEL_CAPABILITIES, ModelCapability } from "@/constants";

interface ModelEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CustomModel | null;
  onUpdate: (model: CustomModel) => void;
}

export const ModelEditDialog: React.FC<ModelEditDialogProps> = ({
  open,
  onOpenChange,
  model,
  onUpdate,
}) => {
  const { modalContainer } = useTab();
  const [localModel, setLocalModel] = useState<CustomModel | null>(model);

  useEffect(() => {
    setLocalModel(model);
  }, [model]);

  if (!localModel) return null;

  const handleUpdate = (field: keyof CustomModel, value: any) => {
    const updatedModel = {
      ...localModel,
      [field]: value,
    };
    setLocalModel(updatedModel);
    onUpdate(updatedModel);
  };

  const capabilityOptions = Object.entries(MODEL_CAPABILITIES).map(([id, description]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    description,
  })) as Array<{ id: ModelCapability; label: string; description: string }>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" container={modalContainer}>
        <DialogHeader>
          <DialogTitle>Model Settings - {localModel.name}</DialogTitle>
          <DialogDescription>Customize model parameters.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <FormField label="Model Name" required>
            <Input
              type="text"
              disabled={localModel.core}
              value={localModel.name}
              onChange={(e) => handleUpdate("name", e.target.value)}
              placeholder="Enter model name"
            />
          </FormField>

          <FormField
            label={
              <div className="flex items-center gap-1.5">
                <span className="leading-none">Display Name</span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent align="start" className="max-w-96" side="bottom">
                      <div className="text-sm text-muted flex flex-col gap-0.5">
                        <div className="text-[12px] font-bold">Suggested format:</div>
                        <div className="text-accent">[Source]-[Payment]:[Pretty Model Name]</div>
                        <div className="text-[12px]">
                          Example:
                          <li>Direct-Paid:Ds-r1</li>
                          <li>OpenRouter-Paid:Ds-r1</li>
                          <li>Perplexity-Paid:lg</li>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
          >
            <Input
              type="text"
              placeholder="Custom display name (optional)"
              value={localModel.displayName || ""}
              onChange={(e) => handleUpdate("displayName", e.target.value)}
            />
          </FormField>

          <FormField label="Model Capabilities">
            <div className="flex gap-4 items-center">
              {capabilityOptions.map(({ id, label, description }) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={localModel.capabilities?.includes(id)}
                    onCheckedChange={(checked) => {
                      const newCapabilities = localModel.capabilities || [];
                      handleUpdate(
                        "capabilities",
                        checked
                          ? [...newCapabilities, id]
                          : newCapabilities.filter((cap) => cap !== id)
                      );
                    }}
                  />
                  <Label htmlFor={id} className="text-sm">
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{label}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{description}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                </div>
              ))}
            </div>
          </FormField>

          {/*            <FormField
              label={
                <div className="flex items-center gap-2">
                  Temperature
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Controls randomness: 0 is focused and deterministic, 2 is more creative
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.temperature ?? 0.1}
                onChange={(value) => handleUpdate("temperature", value)}
                max={2}
                min={0}
                step={0.1}
              />
            </FormField>

            <FormField
              label={
                <div className="flex items-center gap-2">
                  Context
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Maximum number of tokens to use for context
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              }
            >
              <SettingSlider
                value={localModel.context ?? 1000}
                onChange={(value) => handleUpdate("context", value)}
                max={16000}
                min={0}
                step={100}
              />
            </FormField>*/}

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Stream output</span>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Enable streaming responses from the model
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <SettingSwitch
              checked={localModel.stream ?? true}
              onCheckedChange={(checked) => handleUpdate("stream", checked)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
