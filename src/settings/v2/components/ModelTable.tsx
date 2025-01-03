import { CustomModel } from "@/aiParams";
import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getModelKeyFromModel } from "@/settings/model";
import { getProviderLabel } from "@/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Pencil, Plus, Trash2 } from "lucide-react";

interface ModelTableProps {
  models: CustomModel[];
  onEdit?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onAdd: () => void;
  onUpdateModel: (model: CustomModel) => void;
  title: string;
}

export const ModelTable: React.FC<ModelTableProps> = ({
  models,
  onEdit,
  onDelete,
  onAdd,
  onUpdateModel,
  title,
}) => {
  return (
    <div className="mb-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className="text-center">Enable</TableHead>
            <TableHead className="text-center">CORS</TableHead>
            <TableHead className="w-[100px] text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((model) => (
            <TableRow key={getModelKeyFromModel(model)} className="hover:bg-interactive-accent/10">
              <TableCell>{model.name}</TableCell>
              <TableCell>{getProviderLabel(model.provider)}</TableCell>
              <TableCell className="text-center">
                <Checkbox
                  id={`${getModelKeyFromModel(model)}-enabled`}
                  checked={model.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onUpdateModel({ ...model, enabled: checked })
                  }
                  className="mx-auto"
                />
              </TableCell>
              <TableCell className="text-center">
                <Checkbox
                  id={`${getModelKeyFromModel(model)}-enableCors`}
                  checked={model.enableCors}
                  onCheckedChange={(checked: boolean) =>
                    onUpdateModel({ ...model, enableCors: checked })
                  }
                  className="mx-auto"
                />
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  {onEdit && (
                    <Button variant="ghost" size="icon" onClick={() => onEdit(model)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(getModelKeyFromModel(model))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="mt-4 flex justify-end">
        <Button onClick={onAdd} variant="outline" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Custom Model
        </Button>
      </div>
    </div>
  );
};
