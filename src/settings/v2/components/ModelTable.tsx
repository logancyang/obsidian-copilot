import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileCard, MobileCardDropdownAction } from "@/components/ui/mobile-card";
import { ModelCapabilityIcons } from "@/components/ui/model-display";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HelpTooltip } from "@/components/ui/help-tooltip";
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
  Copy,
  Eye,
  Globe,
  GripVertical,
  Lightbulb,
  LucideProps,
  MoreVertical,
  Pencil,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import React, { ForwardRefExoticComponent, RefAttributes, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isRequiredChatModel } from "@/utils/modelUtils";

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

interface ModelTableHeaderProps {
  title: string;
  onRefresh?: () => void;
  onAdd: () => void;
}

/**
 * Renders the model table header with a title and aligned action buttons.
 */
const ModelTableHeader: React.FC<ModelTableHeaderProps> = ({ title, onRefresh, onAdd }) => (
  <div className="tw-mb-3 tw-flex tw-flex-col tw-gap-2 md:tw-flex-row md:tw-items-center md:tw-justify-between">
    <h3 className="tw-text-xl tw-font-bold">{title}</h3>
    <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row sm:tw-items-center sm:tw-justify-end">
      {onRefresh && (
        <Button
          onClick={onRefresh}
          variant="secondary"
          className="tw-flex tw-items-center tw-gap-2"
        >
          <RefreshCw className="tw-size-2 md:tw-size-4" />
          Refresh Built-ins
        </Button>
      )}
      <Button onClick={onAdd} variant="default" className="tw-flex tw-items-center tw-gap-2">
        <Plus className="tw-size-2 md:tw-size-4" />
        Add Model
      </Button>
    </div>
  </div>
);

const renderCapabilities = (model: CustomModel) => {
  return (
    <div className="tw-mx-auto tw-grid tw-w-16 tw-grid-cols-3 tw-gap-1">
      {CAPABILITY_ORDER.map((capability) => {
        const config = CAPABILITY_ICONS[capability];
        if (!config) return <div key={capability} className="tw-w-4" />;

        const Icon = config.icon;
        const hasCapability = model.capabilities?.includes(capability);

        return hasCapability ? (
          <HelpTooltip key={capability} content={config.tooltip} side="bottom">
            <div className="tw-flex tw-items-center tw-justify-center">
              <Icon className={cn("tw-size-4", config.color)} />
            </div>
          </HelpTooltip>
        ) : (
          <div key={capability} className="tw-flex tw-items-center tw-justify-center">
            <div className="tw-size-4" />
          </div>
        );
      })}
    </div>
  );
};

interface ModelCardProps {
  model: CustomModel;
  onEdit?: (model: CustomModel) => void;
  onCopy?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onUpdateModel: (model: CustomModel) => void;
  id: string;
  containerRef: React.RefObject<HTMLDivElement>;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  onEdit,
  onCopy,
  onDelete,
  onUpdateModel,
  id,
  containerRef,
}) => {
  const dropdownActions: MobileCardDropdownAction<CustomModel>[] = [];

  if (onEdit) {
    dropdownActions.push({
      icon: <PencilLine className="tw-size-4" />,
      label: "Edit",
      onClick: onEdit,
    });
  }

  if (onCopy && !model.core) {
    dropdownActions.push({
      icon: <Copy className="tw-size-4" />,
      label: "Copy",
      onClick: onCopy,
    });
  }

  if (!model.core) {
    dropdownActions.push({
      icon: <Trash2 className="tw-size-4" />,
      label: "Delete",
      onClick: () => onDelete(getModelKeyFromModel(model)),
      variant: "destructive",
    });
  }

  const expandedContent = (
    <div className="tw-flex tw-justify-around">
      {!model.isEmbeddingModel && (
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-sm">Enabled</span>
          <Checkbox
            checked={model.enabled}
            onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enabled: checked })}
          />
        </div>
      )}
      <div className="tw-flex tw-items-center tw-gap-2">
        <span className="tw-text-sm">CORS</span>
        <Checkbox
          checked={model.enableCors}
          onCheckedChange={(checked: boolean) => onUpdateModel({ ...model, enableCors: checked })}
        />
      </div>
    </div>
  );

  return (
    <MobileCard
      id={id}
      item={model}
      title={model.displayName || model.name}
      subtitle={getProviderLabel(model.provider, model)}
      badge={
        model.capabilities && model.capabilities.length > 0 ? (
          <ModelCapabilityIcons capabilities={model.capabilities} iconSize={14} />
        ) : undefined
      }
      isDraggable={!model.core}
      isExpandable
      expandedContent={expandedContent}
      primaryAction={
        onEdit
          ? {
              icon: <Pencil className="tw-size-4" />,
              onClick: onEdit,
              tooltip: "Edit Model",
            }
          : undefined
      }
      dropdownActions={dropdownActions}
      containerRef={containerRef}
    />
  );
};

const DesktopSortableTableRow: React.FC<{
  model: CustomModel;
  onEdit?: (model: CustomModel) => void;
  onCopy?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onUpdateModel: (model: CustomModel) => void;
  isEmbeddingModel: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
}> = ({ model, onEdit, onCopy, onDelete, onUpdateModel, isEmbeddingModel, containerRef }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: getModelKeyFromModel(model),
    disabled: model.core,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const showDropdownMenu = onEdit || !model.core || (onCopy && !model.core);

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "tw-transition-colors tw-duration-200 hover:tw-bg-interactive-accent/10",
        isDragging &&
          "tw-relative tw-z-[100] tw-cursor-grabbing tw-shadow-lg tw-backdrop-blur-sm tw-border-accent/50 tw-bg-primary/90"
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
            disabled={model.enabled && isRequiredChatModel(model)}
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

          {showDropdownMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="tw-size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" container={containerRef.current}>
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(model)}>
                    <PencilLine className="tw-mr-2 tw-size-4" />
                    Edit
                  </DropdownMenuItem>
                )}

                {onCopy && !model.core && (
                  <DropdownMenuItem onClick={() => onCopy(model)}>
                    <Copy className="tw-mr-2 tw-size-4" />
                    Copy
                  </DropdownMenuItem>
                )}

                {!model.core && (
                  <DropdownMenuItem
                    onClick={() => onDelete(getModelKeyFromModel(model))}
                    className="tw-text-error"
                  >
                    <Trash2 className="tw-mr-2 tw-size-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

interface ModelTableProps {
  models: CustomModel[];
  onEdit?: (model: CustomModel) => void;
  onCopy?: (model: CustomModel) => void;
  onDelete: (modelKey: string) => void;
  onAdd: () => void;
  onUpdateModel: (model: CustomModel) => void;
  onReorderModels?: (newModels: CustomModel[]) => void;
  onRefresh?: () => void;
  title: string;
}

export const ModelTable: React.FC<ModelTableProps> = ({
  models,
  onEdit,
  onCopy,
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

  const containerRef = useRef<HTMLDivElement>(null);

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
          y: 0,
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
        autoScroll={{
          enabled: true,
          acceleration: 10,
          threshold: {
            x: 0,
            y: 0.2,
          },
        }}
      >
        <SortableContext
          items={models.map((model) => getModelKeyFromModel(model))}
          strategy={verticalListSortingStrategy}
        >
          <div className="tw-relative tw-touch-auto tw-space-y-2 tw-overflow-auto tw-pb-2">
            {models.map((model) => (
              <ModelCard
                key={getModelKeyFromModel(model)}
                id={getModelKeyFromModel(model)}
                containerRef={containerRef}
                model={model}
                onEdit={onEdit}
                onCopy={onCopy}
                onDelete={onDelete}
                onUpdateModel={onUpdateModel}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );

  return (
    <div ref={containerRef} className="tw-mb-4">
      <ModelTableHeader title={title} onRefresh={onRefresh} onAdd={onAdd} />
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
                    <DesktopSortableTableRow
                      key={getModelKeyFromModel(model)}
                      containerRef={containerRef}
                      model={model}
                      onEdit={onEdit}
                      onCopy={onCopy}
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
    </div>
  );
};
