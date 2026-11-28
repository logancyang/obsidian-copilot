import { useEffect, useState } from "react";

export function useStepsAcrossRenders(steps: readonly (() => void)[]): void {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= steps.length) return;
    steps[step]();
    setStep(step + 1);
  }, [step, steps]);
}
