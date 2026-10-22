import {
  createNodeTaskOutputReader,
  EMPTY_TASK_OUTPUT,
  TaskOutputTail,
  type TaskOutputReader,
  type TaskOutputSnapshot,
} from "@/agentMode/session/taskOutputTail";
import { logWarn } from "@/logger";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";

export const TASK_OUTPUT_POLL_MS = 1000;

export const TaskOutputReaderContext = createContext<() => TaskOutputReader>(
  createNodeTaskOutputReader
);

interface TaskOutputTailOptions {
  live: boolean;
  maxBytes: number;
  shownRef?: React.RefObject<HTMLElement>;
}

// A command's output file is outside the vault, so it is re-read while something shows it. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export function useTaskOutputTail(
  outputFile: string | undefined,
  { live, maxBytes, shownRef }: TaskOutputTailOptions
): TaskOutputSnapshot {
  const createReader = useContext(TaskOutputReaderContext);
  const [snapshot, setSnapshot] = useState<TaskOutputSnapshot>(EMPTY_TASK_OUTPUT);

  useEffect(() => {
    if (!outputFile) return;
    const tail = new TaskOutputTail(outputFile, maxBytes, createReader());
    let disposed = false;
    let reading = false;
    const poll = () => {
      if (reading) return;
      reading = true;
      tail
        .poll()
        .then(
          (next) => {
            if (!disposed) setSnapshot(next);
          },
          (error: unknown) => logWarn("[AgentMode] could not read task output", error)
        )
        .finally(() => (reading = false));
    };
    poll();
    if (!live) return () => void (disposed = true);
    // A view left open in a hidden pane must not keep reading the file. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
    const timer = window.setInterval(() => {
      if (shownRef?.current?.isShown() !== false) poll();
    }, TASK_OUTPUT_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [outputFile, live, maxBytes, createReader, shownRef]);

  return snapshot;
}
