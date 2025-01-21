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
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ModelTableProps {
  models: CustomModel[];
  onEdit?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onAdd: () => void;
  onUpdateModel: (model: CustomModel) => void;
  title: string;
}

const ModelCard: React.FC<{
  model: CustomModel;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdateModel: (model: CustomModel) => void;
}> = ({ model, onEdit, onDelete, onUpdateModel }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <Card className="mb-2">
      <CardHeader className="p-3">
        <div
          className="flex items-center justify-between cursor-pointer border-l-[0] border-r-[0] border-t-[0] border-b border-solid border-border pb-2"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 flex items-center justify-center">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 stroke-[7]" />
              ) : (
                <ChevronRight className="h-3 w-3 stroke-[7]" />
              )}
            </div>
            <div>
              <div className="font-medium">{model.name}</div>
              <span className="text-sm text-muted bg-secondary">
                {getProviderLabel(model.provider)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && !model.core && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <div
        className={cn(
          "transition-all duration-300 ease-in-out",
          isExpanded ? "max-h-20 opacity-100" : "max-h-0 opacity-0 overflow-hidden"
        )}
      >
        <CardContent className="p-3 pt-0">
          <div className="flex justify-around">
            {!model.isEmbeddingModel && (
              <div className="flex items-center gap-2">
                <span className="text-sm">Enabled</span>
                <Checkbox
                  checked={model.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onUpdateModel({ ...model, enabled: checked })
                  }
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm">CORS</span>
              <Checkbox
                checked={model.enableCors}
                onCheckedChange={(checked: boolean) =>
                  onUpdateModel({ ...model, enableCors: checked })
                }
              />
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
};

export const ModelTable: React.FC<ModelTableProps> = ({
  models,
  onEdit,
  onDelete,
  onAdd,
  onUpdateModel,
  title,
}) => {
  const isEmbeddingModel = models.length > 0 && models[0].isEmbeddingModel;

  return (
    <div className="mb-4">
      {/* Desktop View */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              {!isEmbeddingModel && <TableHead className="text-center">Enable</TableHead>}
              <TableHead className="text-center">CORS</TableHead>
              <TableHead className="w-[100px] text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow
                key={getModelKeyFromModel(model)}
                className="hover:bg-interactive-accent/10"
              >
                <TableCell>{model.name}</TableCell>
                <TableCell>{getProviderLabel(model.provider)}</TableCell>
                {!isEmbeddingModel && (
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
                )}
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(model)}
                        className="shadow-sm hover:shadow-md transition-shadow"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {!model.core && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(getModelKeyFromModel(model))}
                        className="shadow-sm hover:shadow-md transition-shadow"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile View */}
      <div className="md:hidden">
        <div className="space-y-2">
          {models.map((model) => (
            <ModelCard
              key={getModelKeyFromModel(model)}
              model={model}
              onEdit={onEdit ? () => onEdit(model) : undefined}
              onDelete={() => onDelete(getModelKeyFromModel(model))}
              onUpdateModel={onUpdateModel}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={onAdd} variant="outline" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Custom Model
        </Button>
      </div>
    </div>
  );
};
