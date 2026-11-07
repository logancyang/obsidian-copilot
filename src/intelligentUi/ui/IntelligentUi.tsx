import { useApp } from "@/context";
import { UiNode, UiParseResult } from "@/intelligentUi/parser";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { Component, setIcon } from "obsidian";
import React, { useEffect, useId, useRef } from "react";

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
  return <div ref={ref} className="markdown-rendered tw-min-w-0 tw-break-words" />;
}

function Card(props: NodeProps) {
  const id = useId();
  const { node } = props;
  return (
    <section
      aria-labelledby={node.props.title ? id : undefined}
      className="tw-min-w-0 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4"
    >
      {node.props.title && (
        <h3
          id={id}
          className="tw-m-0 tw-mb-3 tw-flex tw-items-center tw-gap-2 tw-text-base tw-font-semibold"
        >
          {node.props.icon && <Icon name={String(node.props.icon)} decorative />}
          {node.props.title}
        </h3>
      )}
      {!node.props.title && node.props.icon && <Icon name={String(node.props.icon)} />}
      <Children {...props} />
    </section>
  );
}

function Step(props: NodeProps) {
  const { node } = props;
  return (
    <li className="tw-min-w-0">
      <div className="tw-flex tw-items-start tw-gap-2">
        {node.props.icon && <Icon name={String(node.props.icon)} decorative={!!node.props.title} />}
        <div className="tw-min-w-0 tw-flex-1">
          {node.props.title && (
            <h3 className="tw-m-0 tw-mb-2 tw-text-base tw-font-semibold">{node.props.title}</h3>
          )}
          {node.text && <p className="tw-m-0 tw-whitespace-pre-wrap">{node.text}</p>}
          <Children {...props} />
        </div>
      </div>
    </li>
  );
}

function Steps(props: NodeProps) {
  return (
    <ol className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-3 tw-p-0">
      {props.node.children.map((node, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <li aria-hidden="true" className="tw-flex tw-justify-center tw-text-muted">
              ↓
            </li>
          )}
          <Step {...props} node={node} />
        </React.Fragment>
      ))}
    </ol>
  );
}

function Metric({ node }: NodeProps) {
  return (
    <div className="tw-min-w-0 tw-space-y-1">
      <div className="tw-text-2xl tw-font-semibold">{node.props.value}</div>
      <div className="tw-text-sm tw-text-muted">{node.props.label}</div>
      {node.props.delta && <div className="tw-text-sm tw-text-muted">{node.props.delta}</div>}
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

function Primitive(props: NodeProps) {
  const { node } = props;
  switch (node.tag) {
    case "card":
      return <Card {...props} />;
    case "steps":
      return <Steps {...props} />;
    case "step":
      return <Step {...props} />;
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
      return <h2 className="tw-m-0 tw-text-lg tw-font-semibold">{node.text}</h2>;
    case "text":
      return <p className="tw-m-0 tw-whitespace-pre-wrap">{node.text}</p>;
    case "badge":
      return (
        <span className="tw-w-fit tw-rounded tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-2 tw-py-0.5 tw-text-xs">
          {node.text}
        </span>
      );
    case "stack":
      return <Children {...props} />;
    case "panel":
      return (
        <div className="tw-min-w-0 tw-rounded-lg tw-bg-secondary tw-p-3">
          <Children {...props} />
        </div>
      );
    case "row":
    case "grid":
      return (
        <div className="tw-@container">
          <div
            className={cn(
              "tw-grid tw-grid-cols-1 tw-items-start tw-gap-3",
              node.tag === "row"
                ? "@lg:tw-flex [&>*]:tw-min-w-0 [&>*]:tw-flex-1"
                : node.props.columns === 3
                  ? "@lg:tw-grid-cols-3"
                  : node.props.columns === 2
                    ? "@lg:tw-grid-cols-2"
                    : "tw-grid-cols-1"
            )}
          >
            {node.children.map((child, index) => (
              <Primitive key={index} {...props} node={child} />
            ))}
          </div>
        </div>
      );
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
