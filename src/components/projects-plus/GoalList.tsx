import { Goal } from "@/types/projects-plus";
import { Target } from "lucide-react";
import * as React from "react";
import GoalCard from "./GoalCard";

interface GoalListProps {
  goals: Goal[];
  onEditGoal: (goal: Goal) => void;
  onCompleteGoal: (goalId: string) => void;
  onDeleteGoal: (goalId: string) => void;
}

/**
 * GoalList - Renders a list of goal cards or empty state
 */
export default function GoalList({
  goals,
  onEditGoal,
  onCompleteGoal,
  onDeleteGoal,
}: GoalListProps) {
  if (goals.length === 0) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-12 tw-text-muted">
        <Target className="tw-mb-4 tw-size-12 tw-opacity-50" />
        <p className="tw-text-base tw-font-medium">No goals yet</p>
        <p className="tw-text-sm tw-text-faint">Create your first goal to get started</p>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          onEdit={() => onEditGoal(goal)}
          onComplete={() => onCompleteGoal(goal.id)}
          onDelete={() => onDeleteGoal(goal.id)}
        />
      ))}
    </div>
  );
}
