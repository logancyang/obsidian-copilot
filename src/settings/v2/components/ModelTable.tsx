import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelCapabilityIcons } from "@/components/ui/model-display";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MODEL_CAPABILITIES, ModelCapability } from "@/constants";
import { cn } from "@/lib/utils";
import { getModelKeyFromModel } from "@/settings/model";
import { getProviderLabel } from "@/utils";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Globe,
  GripVertical,
  Lightbulb,
  LucideProps,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import React, { ForwardRefExoticComponent, RefAttributes } from "react";

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
    color: "tw-text-model-capabilities-blue",
    tooltip: MODEL_CAPABILITIES.reasoning,
  },
  [ModelCapability.VISION]: {
    icon: Eye,
    color: "tw-text-model-capabilities-green",
    tooltip: MODEL_CAPABILITIES.vision,
  },
  [ModelCapability.WEB_SEARCH]: {
    icon: Globe,
    color: "tw-text-model-capabilities-blue",
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
      <div className="tw-mx-auto tw-grid tw-w-16 tw-grid-cols-3 tw-gap-1">
        {CAPABILITY_ORDER.map((capability) => {
          const config = CAPABILITY_ICONS[capability];
          if (!config) return <div key={capability} className="tw-w-4" />;

          const Icon = config.icon;
          const hasCapability = model.capabilities?.includes(capability);

          return hasCapability ? (
            <Tooltip key={capability}>
              <TooltipTrigger asChild>
                <div className="tw-flex tw-items-center tw-justify-center">
                  <Icon className={cn("tw-size-4", config.color)} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{config.tooltip}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={capability} className="tw-flex tw-items-center tw-justify-center">
              <div className="tw-size-4" />
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
  onRefresh?: () => void;
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
        "tw-mb-2",
        isDragging && [
<<<<<<< HEAD
          "opacity-90",
          "shadow-lg",
          "border-2",
          "border-accent/50",
          "relative",
          "z-[9999]",
          "bg-primary",
          "rounded-lg",
          "transform-gpu",
=======
          "tw-opacity-90",
          "tw-shadow-lg",
          "tw-border-accent/50",
          "tw-relative",
          "tw-z-[9999]",
          "tw-bg-background",
          "tw-rounded-lg",
          "tw-transform-gpu",
>>>>>>> f8c5f55 (More classname fixes)
        ],
        !model.core && "tw-touch-none"
      )}
    >
      <CardHeader className="tw-p-3">
        <div className="tw-flex tw-items-center tw-justify-between">
          {!model.core && (
            <div
              className="tw-mr-2 tw-cursor-grab tw-touch-none active:tw-cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="tw-size-4" />
            </div>
          )}

          <div className="tw-flex-1 tw-cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="tw-flex tw-items-center tw-gap-2">
              <div className="tw-flex tw-size-3 tw-items-center tw-justify-center">
                {isExpanded ? (
                  <ChevronDown className="tw-size-3 tw-stroke-[7]" />
                ) : (
                  <ChevronRight className="tw-size-3 tw-stroke-[7]" />
                )}
              </div>
              <div>
                <div className="tw-flex tw-items-center tw-gap-1">
                  <span className="tw-font-medium">{model.displayName || model.name}</span>
                  {model.capabilities && model.capabilities.length > 0 && (
                    <ModelCapabilityIcons capabilities={model.capabilities} iconSize={14} />
                  )}
                </div>
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span className="tw-bg-secondary tw-text-sm tw-text-muted">
                    {getProviderLabel(model.provider, model)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="tw-flex tw-items-center tw-gap-2">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="tw-size-4" />
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
                <Trash2 className="tw-size-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <div
        className={cn(
          "tw-transition-all tw-duration-300 tw-ease-in-out",
          isExpanded ? "tw-max-h-20 tw-opacity-100" : "tw-max-h-0 tw-overflow-hidden tw-opacity-0"
        )}
      >
        <CardContent className="tw-p-3 tw-pt-0">
          <div className="tw-flex tw-justify-around">
            {!model.isEmbeddingModel && (
              <div className="tw-flex tw-items-center tw-gap-2">
                <span className="tw-text-sm">Enabled</span>
                <Checkbox
                  checked={model.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onUpdateModel({ ...model, enabled: checked })
                  }
                />
              </div>
            )}
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-sm">CORS</span>
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
        "tw-transition-colors tw-duration-200 hover:tw-bg-interactive-accent/10",
        isDragging &&
<<<<<<< HEAD
          "shadow-lg bg-primary/90 backdrop-blur-sm relative z-[100] cursor-grabbing border-2 border-accent/50",
        !isDragging && "z-auto"
=======
          "tw-relative tw-z-[100] tw-cursor-grabbing tw-shadow-lg tw-backdrop-blur-sm tw-border-accent/50 tw-bg-background/90"
>>>>>>> f8c5f55 (More classname fixes)
      )}
    >
      <TableCell className="tw-w-6 tw-px-2">
        {!model.core && (
          <Button
            variant="ghost"
            size="icon"
            className="tw-size-6 tw-cursor-grab tw-touch-none tw-p-0 hover:tw-cursor-grab active:tw-cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="tw-size-4 tw-transition-colors" />
          </Button>
        )}
      </TableCell>
      <TableCell className="tw-pl-0">{model.displayName || model.name}</TableCell>
      <TableCell>{getProviderLabel(model.provider, model)}</TableCell>
      <TableCell>{renderCapabilities(model)}</TableCell>
      {!isEmbeddingModel && (
        <TableCell className="tw-text-center">
          <Checkbox
            id={`${getModelKeyFromModel(model)}-enabled`}
            checked={model.enabled}
            onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enabled: checked })}
            className="tw-mx-auto"
          />
        </TableCell>
      )}
      <TableCell className="tw-text-center">
        <Checkbox
          id={`${getModelKeyFromModel(model)}-enableCors`}
          checked={model.enableCors}
          onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enableCors: checked })}
          className="tw-mx-auto"
        />
      </TableCell>
      <TableCell className="tw-text-center">
        <div className="tw-flex tw-justify-center tw-gap-2">
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(model)}
              className="tw-shadow-sm tw-transition-shadow hover:tw-shadow-md"
            >
              <Pencil className="tw-size-4" />
            </Button>
          )}
          {!model.core && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(getModelKeyFromModel(model))}
              className="tw-shadow-sm tw-transition-shadow hover:tw-shadow-md"
            >
              <Trash2 className="tw-size-4" />
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
  onRefresh,
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
    <div className="tw-relative md:tw-hidden">
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
          <div className="tw-relative tw-space-y-2">
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
    <div className="tw-mb-4">
      {/* Desktop view */}
      <div className="tw-hidden md:tw-block">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[createDragModifier(false)]}
        >
          <div className="tw-relative tw-overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="tw-w-6 tw-px-2"></TableHead>
                  <TableHead className="tw-pl-0">Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="tw-text-center">Capabilities</TableHead>
                  {!isEmbeddingModel && <TableHead className="tw-text-center">Enable</TableHead>}
                  <TableHead className="tw-text-center">CORS</TableHead>
                  <TableHead className="tw-w-[100px] tw-text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tw-relative">
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

      <div className="mt-4 flex justify-end gap-2">
        {onRefresh && (
          <Button onClick={onRefresh} variant="secondary" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh Built-in Models
          </Button>
        )}
        <Button onClick={onAdd} variant="secondary" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Custom Model
        </Button>
      </div>
    </div>
  );
};
