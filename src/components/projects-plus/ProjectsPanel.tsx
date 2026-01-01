import CopilotPlugin from "@/main";
import { Goal, GoalStatus, CreateGoalInput, UpdateGoalInput } from "@/types/projects-plus";
import { Plus, Search } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import GoalList from "./GoalList";
import GoalDialog from "./GoalDialog";

interface ProjectsPanelProps {
  plugin: CopilotPlugin;
}

type FilterStatus = GoalStatus | "all";

/**
 * ProjectsPanel - Main container for the Projects+ interface
 *
 * Displays goal list with search/filter capabilities and
 * provides goal creation functionality.
 */
export default function ProjectsPanel({ plugin }: ProjectsPanelProps) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  // Subscribe to GoalManager changes
  useEffect(() => {
    const unsubscribe = plugin.goalManager.subscribe(() => {
      setGoals(plugin.goalManager.getAllGoals());
    });

    // Initial load
    setGoals(plugin.goalManager.getAllGoals());

    return unsubscribe;
  }, [plugin.goalManager]);

  // Filter and search logic
  const filteredGoals = useMemo(() => {
    let result = goals;

    // Filter by status
    if (filter !== "all") {
      result = result.filter((g) => g.status === filter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (g) => g.name.toLowerCase().includes(query) || g.description.toLowerCase().includes(query)
      );
    }

    // Sort by most recently updated
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [goals, filter, searchQuery]);

  const handleCreateGoal = useCallback(
    async (input: CreateGoalInput) => {
      await plugin.goalManager.createGoal(input);
      setIsCreateDialogOpen(false);
    },
    [plugin.goalManager]
  );

  const handleUpdateGoal = useCallback(
    async (input: UpdateGoalInput) => {
      if (editingGoal) {
        await plugin.goalManager.updateGoal(editingGoal.id, input);
        setEditingGoal(null);
      }
    },
    [plugin.goalManager, editingGoal]
  );

  const handleCompleteGoal = useCallback(
    async (goalId: string) => {
      await plugin.goalManager.completeGoal(goalId);
    },
    [plugin.goalManager]
  );

  const handleDeleteGoal = useCallback(
    async (goalId: string) => {
      await plugin.goalManager.deleteGoal(goalId);
    },
    [plugin.goalManager]
  );

  const handleEditGoal = useCallback((goal: Goal) => {
    setEditingGoal(goal);
  }, []);

  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-p-4">
      {/* Header */}
      <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between">
        <h2 className="tw-text-lg tw-font-semibold tw-text-normal">Projects+</h2>
        <Button
          size="sm"
          onClick={() => setIsCreateDialogOpen(true)}
          className="tw-flex tw-items-center tw-gap-1"
        >
          <Plus className="tw-size-4" />
          New Goal
        </Button>
      </div>

      {/* Search bar */}
      <div className="tw-mb-4 tw-flex tw-gap-2">
        <div className="tw-relative tw-flex-1">
          <Search className="tw-absolute tw-left-2 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-muted" />
          <Input
            placeholder="Search goals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="tw-pl-8"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterStatus)}
          className="tw-rounded-md tw-border tw-border-border tw-bg-primary tw-px-3 tw-py-1 tw-text-sm tw-text-normal"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Goal list */}
      <div className="tw-flex-1 tw-overflow-y-auto">
        <GoalList
          goals={filteredGoals}
          onEditGoal={handleEditGoal}
          onCompleteGoal={handleCompleteGoal}
          onDeleteGoal={handleDeleteGoal}
        />
      </div>

      {/* Create dialog */}
      <GoalDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSave={handleCreateGoal}
        title="Create New Goal"
      />

      {/* Edit dialog */}
      <GoalDialog
        open={!!editingGoal}
        onOpenChange={(open) => !open && setEditingGoal(null)}
        goal={editingGoal ?? undefined}
        onSave={handleUpdateGoal}
        title="Edit Goal"
      />
    </div>
  );
}
