import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import { RECORDED_STREAM_END, recordedFenceAt } from "@/intelligentUi/ui/UiFence.fixtures";
import { UiFence, UiFenceProps } from "@/intelligentUi/ui/UiFence";
import React from "react";

const SPEEDS = [1, 0.25] as const;

function StreamReplay() {
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);
  const [run, setRun] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const started = performance.now();
    let frame = window.requestAnimationFrame(function tick() {
      const ms = (performance.now() - started) * speed;
      setElapsed(Math.min(ms, RECORDED_STREAM_END));
      if (ms < RECORDED_STREAM_END) frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [run, speed]);
  const fence = recordedFenceAt(elapsed);
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div className="tw-flex tw-items-center tw-gap-2">
        <Button size="sm" onClick={() => setRun((value) => value + 1)}>
          Replay
        </Button>
        {SPEEDS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === speed ? "default" : "secondary"}
            onClick={() => setSpeed(value)}
          >
            {value}×
          </Button>
        ))}
        <span className="tw-text-ui-smaller tw-text-muted">{Math.round(elapsed)} ms</span>
      </div>
      <UiFence source={fence.body} sourcePath="Research.md" streaming closed={fence.closed} />
    </div>
  );
}

const at = (ms: number): UiFenceProps => {
  const fence = recordedFenceAt(ms);
  return { source: fence.body, sourcePath: "Research.md", streaming: true, closed: fence.closed };
};

const meta = {
  title: "Intelligent UI/Streaming",
  component: UiFence,
  args: at(345),
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<UiFenceProps>;
export default meta;

export const RecordedReplay: StoryObj<UiFenceProps> = { render: () => <StreamReplay /> };
export const FirstBurst: StoryObj<UiFenceProps> = { args: at(345) };
export const SecondCardArriving: StoryObj<UiFenceProps> = { args: at(429) };
export const StepsArriving: StoryObj<UiFenceProps> = { args: at(763) };
export const Finished: StoryObj<UiFenceProps> = { args: at(RECORDED_STREAM_END) };
