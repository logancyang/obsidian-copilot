import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getModelKeyFromModel } from "@/settings/model";
import { getProviderLabel } from "@/utils";
import {
  Move,
  Pencil,
  Plus,
  Trash2,
  Lightbulb,
  Eye,
  Globe,
  ChevronDown,
  ChevronRight,
  LucideProps,
} from "lucide-react";
import React, { ForwardRefExoticComponent, RefAttributes } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelCapabilityIcons } from "@/components/ui/model-display";
import { MODEL_CAPABILITIES, ModelCapability } from "@/constants";

const CAPABILITY_ICONS: Record<
  ModelCapability,
  {
    icon: ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>;
    color: string;
    tooltip: string;
  }
> = {
  [ModelCapability.REASONING]: {
    icon: Lightbulb,
    color: "text-model-capabilities-blue",
    tooltip: MODEL_CAPABILITIES.reasoning,
  },
  [ModelCapability.VISION]: {
    icon: Eye,
    color: "text-model-capabilities-green",
    tooltip: MODEL_CAPABILITIES.vision,
  },
  [ModelCapability.WEB_SEARCH]: {
    icon: Globe,
    color: "text-model-capabilities-blue",
    tooltip: MODEL_CAPABILITIES.websearch,
  },
} as const;

const CAPABILITY_ORDER = [
  ModelCapability.REASONING,
  ModelCapability.VISION,
  ModelCapability.WEB_SEARCH,
] as const;

const renderCapabilities = (model: CustomModel) => {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="grid grid-cols-3 gap-1 w-16 mx-auto">
        {CAPABILITY_ORDER.map((capability) => {
          const config = CAPABILITY_ICONS[capability];
          if (!config) return <div key={capability} className="w-4" />;

          const Icon = config.icon;
          const hasCapability = model.capabilities?.includes(capability);

          return hasCapability ? (
            <Tooltip key={capability}>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center">
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{config.tooltip}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={capability} className="flex items-center justify-center">
              <div className="w-4 h-4" />
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

interface ModelTableProps {
  models: CustomModel[];
  onEdit?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onAdd: () => void;
  onUpdateModel: (model: CustomModel) => void;
  onReorderModels?: (newModels: CustomModel[]) => void;
  title: string;
}

interface ModelCardProps {
  model: CustomModel;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdateModel: (model: CustomModel) => void;
  id: string;
}

const ModelCard: React.FC<ModelCardProps> = ({ model, onEdit, onDelete, onUpdateModel, id }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: model.core,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "mb-2",
        isDragging && [
          "opacity-90",
          "shadow-lg",
          "border-2",
          "border-accent/50",
          "relative",
          "z-[9999]",
          "bg-primary",
          "rounded-lg",
          "transform-gpu",
        ],
        !model.core && "touch-none"
      )}
    >
      <CardHeader className="p-3">
        <div className="flex items-center justify-between">
          {!model.core && (
            <div
              className="mr-2 touch-none cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <Move className="h-4 w-4 text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 flex items-center justify-center">
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 stroke-[7]" />
                ) : (
                  <ChevronRight className="h-3 w-3 stroke-[7]" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <span className="font-medium">{model.displayName || model.name}</span>
                  {model.capabilities && model.capabilities.length > 0 && (
                    <ModelCapabilityIcons capabilities={model.capabilities} iconSize={14} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted bg-secondary">
                    {getProviderLabel(model.provider, model)}
                  </span>
                </div>
              </div>
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

const SortableTableRow: React.FC<{
  model: CustomModel;
  onEdit?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onUpdateModel: (model: CustomModel) => void;
  isEmbeddingModel: boolean;
}> = ({ model, onEdit, onDelete, onUpdateModel, isEmbeddingModel }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: getModelKeyFromModel(model),
    disabled: model.core,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "hover:bg-interactive-accent/10 transition-colors duration-200",
        isDragging &&
          "shadow-lg bg-primary/90 backdrop-blur-sm relative z-[100] cursor-grabbing border-2 border-accent/50",
        !isDragging && "z-auto"
      )}
    >
      <TableCell className="w-6 px-2">
        {!model.core && (
          <Button
            variant="ghost"
            size="icon"
            className="cursor-grab touch-none hover:cursor-grab active:cursor-grabbing p-0 h-6 w-6"
            {...attributes}
            {...listeners}
          >
            <Move className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
          </Button>
        )}
      </TableCell>
      <TableCell className="pl-0">{model.displayName || model.name}</TableCell>
      <TableCell>{getProviderLabel(model.provider, model)}</TableCell>
      <TableCell className="text-center flex justify-center">{renderCapabilities(model)}</TableCell>
      {!isEmbeddingModel && (
        <TableCell className="text-center">
          <Checkbox
            id={`${getModelKeyFromModel(model)}-enabled`}
            checked={model.enabled}
            onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enabled: checked })}
            className="mx-auto"
          />
        </TableCell>
      )}
      <TableCell className="text-center">
        <Checkbox
          id={`${getModelKeyFromModel(model)}-enableCors`}
          checked={model.enableCors}
          onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enableCors: checked })}
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
  );
};

export const ModelTable: React.FC<ModelTableProps> = ({
  models,
  onEdit,
  onDelete,
  onAdd,
  onUpdateModel,
  onReorderModels,
  title,
}) => {
  const isEmbeddingModel = !!(models.length > 0 && models[0].isEmbeddingModel);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Find the index of the first non-core model
  const firstDraggableIndex = models.findIndex((model) => !model.core);

  // Create unified modifier logic
  const createDragModifier = (isMobile: boolean) => (args: any) => {
    const { transform, active, activeNodeRect, over } = args;
    if (!active || !activeNodeRect) return transform;

    // Get the index of current dragging item
    const currentIndex = models.findIndex((model) => getModelKeyFromModel(model) === active.id);

    // Calculate the number of non-core items
    const draggableItemsCount = models.filter((model) => !model.core).length;

    // Calculate row height
    const rowHeight = activeNodeRect.height;

    // Calculate draggable range
    const minY = (firstDraggableIndex - currentIndex) * rowHeight;
    const maxY = (firstDraggableIndex + draggableItemsCount - 1 - currentIndex) * rowHeight;

    // For mobile view, check if hovering over a core model
    if (isMobile && over) {
      const overIndex = models.findIndex((model) => getModelKeyFromModel(model) === over.id);
      const overModel = models[overIndex];

      // If hovering over a core model, return to original position
      if (overModel.core || overIndex < firstDraggableIndex) {
        return {
          ...transform,
          x: 0,
          y: currentIndex * rowHeight,
        };
      }
    }

    // Restrict within draggable range
    return {
      ...transform,
      x: 0,
      y: Math.min(Math.max(minY, transform.y), maxY),
    };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = models.findIndex((model) => getModelKeyFromModel(model) === active.id);
      const newIndex = models.findIndex((model) => getModelKeyFromModel(model) === over.id);

      // Get target model
      const targetModel = models[newIndex];

      // 1. Prevent moving to core model positions
      if (newIndex < firstDraggableIndex) {
        return;
      }

      // 2. Prevent moving to other non-draggable model positions
      if (targetModel.core) {
        return;
      }

      const newModels = arrayMove(models, oldIndex, newIndex);
      onReorderModels?.(newModels);
    }
  };

  // Mobile view rendering
  const renderMobileView = () => (
    <div className="md:hidden relative">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[createDragModifier(true)]}
      >
        <SortableContext
          items={models.map((model) => getModelKeyFromModel(model))}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 relative">
            {models.map((model) => (
              <ModelCard
                key={getModelKeyFromModel(model)}
                id={getModelKeyFromModel(model)}
                model={model}
                onEdit={onEdit ? () => onEdit(model) : undefined}
                onDelete={() => onDelete(getModelKeyFromModel(model))}
                onUpdateModel={onUpdateModel}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );

  return (
    <div className="mb-4">
      {/* Desktop view */}
      <div className="hidden md:block">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[createDragModifier(false)]}
        >
          <div className="relative overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-2"></TableHead>
                  <TableHead className="pl-0">Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-center">Capabilities</TableHead>
                  {!isEmbeddingModel && <TableHead className="text-center">Enable</TableHead>}
                  <TableHead className="text-center">CORS</TableHead>
                  <TableHead className="w-[100px] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="relative">
                <SortableContext
                  items={models.map((model) => getModelKeyFromModel(model))}
                  strategy={verticalListSortingStrategy}
                >
                  {models.map((model) => (
                    <SortableTableRow
                      key={getModelKeyFromModel(model)}
                      model={model}
                      onEdit={onEdit ? () => onEdit(model) : undefined}
                      onDelete={onDelete}
                      onUpdateModel={onUpdateModel}
                      isEmbeddingModel={isEmbeddingModel}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </div>
        </DndContext>
      </div>

      {/* Mobile view */}
      {renderMobileView()}

      <div className="mt-4 flex justify-end">
        <Button onClick={onAdd} variant="secondary" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Custom Model
        </Button>
      </div>
    </div>
  );
};
