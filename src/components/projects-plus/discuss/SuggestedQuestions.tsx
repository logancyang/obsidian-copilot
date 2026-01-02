/**
 * SuggestedQuestions - Initial question chips for new conversations
 */

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import * as React from "react";

interface SuggestedQuestionsProps {
  questions: string[];
  onSelect: (question: string) => void;
  loading?: boolean;
}

/**
 * Displays suggested questions as clickable chips
 */
export function SuggestedQuestions({ questions, onSelect, loading }: SuggestedQuestionsProps) {
  if (loading) {
    return (
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-muted">
        <span className="tw-animate-pulse">Generating suggestions...</span>
      </div>
    );
  }

  if (!questions || questions.length === 0) return null;

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <span className="tw-text-xs tw-text-muted">Suggested questions:</span>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        {questions.map((question, idx) => (
          <Button
            key={idx}
            variant="secondary"
            size="sm"
            onClick={() => onSelect(question)}
            className="tw-h-auto tw-max-w-full tw-whitespace-normal tw-text-left tw-text-xs"
          >
            <MessageCircle className="tw-mr-1 tw-size-3 tw-shrink-0" />
            <span className="tw-line-clamp-2">{question}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
