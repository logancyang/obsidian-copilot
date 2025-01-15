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
import { SettingSlider } from "@/components/ui/setting-slider";
import { SettingSwitch } from "@/components/ui/setting-switch";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" container={modalContainer}>
        <DialogHeader>
          <DialogTitle>Model Settings - {localModel.name}</DialogTitle>
          <DialogDescription>Customize model parameters.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                Temperature
                <HelpCircle className="h-4 w-4 text-muted" />
              </div>
            </div>
            <SettingSlider
              value={localModel.temperature ?? 0.1}
              onChange={(value) => handleUpdate("temperature", value)}
              max={2}
              min={0}
              step={0.1}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                Context
                <HelpCircle className="h-4 w-4 text-muted" />
              </div>
            </div>
            <SettingSlider
              value={localModel.context ?? 1000}
              onChange={(value) => handleUpdate("context", value)}
              max={16000}
              min={0}
              step={100}
            />
          </div>

          <div className="py-2 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">Stream output</div>
              <SettingSwitch
                checked={localModel.stream ?? true}
                onCheckedChange={(checked) => handleUpdate("stream", checked)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
