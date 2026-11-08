import { useApp } from "@/context";
import { UiNode, UiParseResult } from "@/intelligentUi/parser";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component, setIcon } from "obsidian";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Card as UiCard } from "@/components/ui/card";
import React, { useContext, useEffect, useId, useRef, useState } from "react";

export interface IntelligentUiProps {
  result: UiParseResult;
  source: string;
  sourcePath: string;
}
interface NodeProps {
  node: UiNode;
  sourcePath: string;
}
interface IconProps {
  name: string;
  decorative?: boolean;
}

function Icon({ name, decorative = false }: IconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return (
    <span
      ref={ref}
      className="tw-inline-flex tw-shrink-0 tw-items-center tw-text-muted"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name.replaceAll("-", " ")}
      aria-hidden={decorative || undefined}
    />
  );
}

function Markdown({ node, sourcePath }: NodeProps) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const target = host.createDiv();
    const owner = new Component();
    let disposed = false;
    let settled = false;
    owner.load();
    // Detached rendering prevents an older async body from overwriting a newer one. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
    host.replaceChildren();
    void renderMarkdown(app, node.text, target, sourcePath, owner)
      .catch(() => {
        // A failed Markdown renderer must still leave the model's words readable. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
        target.textContent = node.text;
      })
      .then(() => {
        settled = true;
        if (disposed) owner.unload();
        else host.replaceChildren(target);
      });
    return () => {
      disposed = true;
      // Renderers may register cleanup until their promise settles. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
      if (settled) owner.unload();
    };
  }, [app, node.text, sourcePath]);
  return (
    <div
      ref={ref}
      className="markdown-rendered tw-min-w-0 tw-break-words [&>div>:first-child]:tw-mt-0 [&>div>:last-child]:tw-mb-0"
    />
  );
}

const ATOMS: readonly string[] = ["icon", "badge", "divider"];
const InBoxContext = React.createContext(false);

function Card(props: NodeProps) {
  const id = useId();
  const { node } = props;
  const { title, icon, description } = node.props;
  return (
    <UiCard
      role={title ? "region" : undefined}
      aria-labelledby={title ? id : undefined}
      className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3 tw-rounded-lg tw-border-solid tw-p-4"
    >
      {(title || description) && (
        <div className="tw-flex tw-flex-col tw-gap-1">
          {title && (
            <h3
              id={id}
              className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-ui-medium tw-font-semibold tw-leading-tight"
            >
              {icon && <Icon name={String(icon)} decorative />}
              {title}
            </h3>
          )}
          {description && <p className="tw-m-0 tw-text-ui-small tw-text-muted">{description}</p>}
        </div>
      )}
      {!title && icon && <Icon name={String(icon)} />}
      <InBoxContext.Provider value>
        <Children {...props} />
      </InBoxContext.Provider>
    </UiCard>
  );
}

function Callout(props: NodeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tone = String(props.node.props.tone ?? "note");
  useEffect(() => {
    // Themes define each callout's icon, so read it instead of hardcoding one per tone. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
    const icon = getComputedStyle(ref.current!).getPropertyValue("--callout-icon").trim();
    const slot = ref.current!.querySelector<HTMLElement>(".callout-icon");
    if (icon && slot) setIcon(slot, icon);
  }, [tone]);
  return (
    <div ref={ref} className="callout tw-m-0" data-callout={tone}>
      <div className="callout-title">
        <div className="callout-icon" aria-hidden="true" />
        <div className="callout-title-inner">
          {props.node.props.title ?? tone[0].toUpperCase() + tone.slice(1)}
        </div>
      </div>
      <div className="callout-content tw-pt-2">
        <InBoxContext.Provider value>
          <Children {...props} />
        </InBoxContext.Provider>
      </div>
    </div>
  );
}

function Tabs(props: NodeProps) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const tabs = props.node.children;
  const active = Math.min(selected, tabs.length - 1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    refs.current[next]?.focus();
  };
  if (!tabs.length) return null;
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3">
      <div
        role="tablist"
        className="tw-flex tw-w-fit tw-max-w-full tw-gap-1 tw-overflow-x-auto tw-rounded-lg tw-bg-secondary tw-p-1"
      >
        {tabs.map((tab, index) => (
          <div
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${id}-panel`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(active + 1);
              else if (event.key === "ArrowLeft") move(active - 1);
            }}
            className={cn(
              "tw-cursor-pointer tw-whitespace-nowrap tw-rounded-md tw-px-3 tw-py-1 tw-text-ui-small tw-font-medium tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
              index === active
                ? "tw-bg-primary tw-text-normal tw-shadow-sm"
                : "tw-text-muted hover:tw-text-normal"
            )}
          >
            {tab.props.title}
          </div>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`}>
        <Children {...props} node={tabs[active]} />
      </div>
    </div>
  );
}

function Steps(props: NodeProps) {
  const steps = props.node.children;
  return (
    <ol className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-p-0">
      {steps.map((node, index) => (
        <li key={index} className="tw-flex tw-min-w-0 tw-gap-3">
          <div aria-hidden="true" className="tw-flex tw-flex-col tw-items-center">
            <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-text-ui-smaller tw-font-medium tw-text-muted">
              {node.props.icon ? <Icon name={String(node.props.icon)} decorative /> : index + 1}
            </span>
            {index < steps.length - 1 && (
              <span className="tw-my-1 tw-w-px tw-flex-1 tw-bg-[var(--background-modifier-border)]" />
            )}
          </div>
          <div
            className={cn(
              "tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1",
              index < steps.length - 1 && "tw-pb-4"
            )}
          >
            {node.props.title && (
              <h3 className="tw-m-0 tw-text-ui-medium tw-font-semibold tw-leading-6">
                {node.props.title}
              </h3>
            )}
            {node.text && (
              <p
                className={cn(
                  "tw-m-0 tw-whitespace-pre-wrap tw-leading-6",
                  node.props.title && "tw-text-muted"
                )}
              >
                {node.text}
              </p>
            )}
            <Children {...props} node={node} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Metric({ node }: NodeProps) {
  const inBox = useContext(InBoxContext);
  const delta = node.props.delta === undefined ? "" : String(node.props.delta);
  // A signed change reads as a trend; colour is withheld because a drop can be good news. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
  const trend = /^\+/.test(delta)
    ? "trending-up"
    : /^[-\u2212]/.test(delta)
      ? "trending-down"
      : null;
  return (
    <div
      className={cn(
        "tw-flex tw-min-w-0 tw-flex-col tw-gap-1",
        !inBox && "tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4"
      )}
    >
      <div className="tw-text-ui-small tw-text-muted">{node.props.label}</div>
      <div className="tw-text-2xl tw-font-semibold tw-leading-tight">{node.props.value}</div>
      {delta && (
        <div className="tw-flex tw-items-center tw-gap-1 tw-text-ui-smaller">
          {trend && <Icon name={trend} decorative />}
          <span className="tw-text-muted">{delta}</span>
        </div>
      )}
    </div>
  );
}

function Children(props: NodeProps) {
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3">
      {props.node.children.map((node, index) => (
        <Primitive key={index} {...props} node={node} />
      ))}
    </div>
  );
}

function Heading({ node }: NodeProps) {
  return useContext(InBoxContext) ? (
    <h4 className="tw-m-0 tw-text-ui-small tw-font-semibold tw-text-muted">{node.text}</h4>
  ) : (
    <h2 className="tw-m-0 tw-text-ui-larger tw-font-semibold tw-leading-tight">{node.text}</h2>
  );
}

function RowItem(props: NodeProps) {
  const { node } = props;
  if (node.tag === "divider")
    return (
      <div
        role="separator"
        className="tw-h-px tw-w-full tw-shrink-0 tw-self-stretch tw-bg-[var(--background-modifier-border)] @lg:tw-h-auto @lg:tw-w-px"
      />
    );
  if (!ATOMS.includes(node.tag))
    return (
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col [&>*]:tw-flex-1">
        <Primitive {...props} />
      </div>
    );
  return (
    <div
      className={cn(
        "tw-flex tw-flex-none tw-items-center tw-justify-center",
        // A connecting arrow must follow the stacked direction on narrow panes. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
        String(node.props.name).startsWith("arrow-") && "tw-rotate-90 @lg:tw-rotate-0"
      )}
    >
      <Primitive {...props} />
    </div>
  );
}

function Primitive(props: NodeProps) {
  const { node } = props;
  switch (node.tag) {
    case "card":
      return <Card {...props} />;
    case "callout":
      return <Callout {...props} />;
    case "tabs":
      return <Tabs {...props} />;
    case "steps":
      return <Steps {...props} />;
    case "metric":
      return <Metric {...props} />;
    case "markdown":
      return <Markdown {...props} />;
    case "icon":
      return <Icon name={String(node.props.name)} />;
    case "divider":
      return (
        <hr className="tw-m-0 tw-w-full tw-border-0 tw-border-t tw-border-solid tw-border-border" />
      );
    case "heading":
      return <Heading {...props} />;
    case "text":
      return <p className="tw-m-0 tw-whitespace-pre-wrap">{node.text}</p>;
    case "badge":
      return (
        <UiBadge variant="outline" className="tw-w-fit">
          {node.text}
        </UiBadge>
      );
    case "stack":
      return <Children {...props} />;
    case "panel":
      return (
        <div className="tw-min-w-0 tw-rounded-lg tw-bg-secondary tw-p-4">
          <InBoxContext.Provider value>
            <Children {...props} />
          </InBoxContext.Provider>
        </div>
      );
    case "row":
      return (
        <div className="tw-@container">
          <div className="tw-flex tw-flex-col tw-gap-3 @lg:tw-flex-row">
            {node.children.map((child, index) => (
              <RowItem key={index} {...props} node={child} />
            ))}
          </div>
        </div>
      );
    case "grid":
      return (
        <div className="tw-@container">
          <div
            className={cn(
              "tw-grid tw-grid-cols-1 tw-gap-3",
              node.props.columns === 3 && "@lg:tw-grid-cols-3",
              node.props.columns === 2 && "@lg:tw-grid-cols-2"
            )}
          >
            {node.children.map((child, index) => (
              <Primitive key={index} {...props} node={child} />
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function IntelligentUi({ result, source, sourcePath }: IntelligentUiProps) {
  // Rejected blocks retain their entire body, including malformed markup and fence text. https://github.com/Brevilabs/obsidian-copilot-private/issues/881
  if (result.status === "error")
    return (
      <div className="tw-min-w-0 tw-space-y-3">
        <p role="status" className="tw-m-0 tw-text-sm tw-text-muted">
          This layout could not be displayed. Original source:
        </p>
        <pre className="tw-m-0 tw-overflow-x-auto tw-rounded tw-bg-secondary tw-p-3">
          <code>{source}</code>
        </pre>
      </div>
    );
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3 tw-break-words tw-text-normal">
      {result.nodes.map((node, index) => (
        <Primitive key={index} node={node} sourcePath={sourcePath} />
      ))}
    </div>
  );
}
