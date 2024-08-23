import React, { FC, memo } from "react";
import ReactMarkdown, { Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import CodeBlock from "./CodeBlock";

const MemoizedReactMarkdown: FC<Options> = memo((props) => {
  return (
    <ReactMarkdown
      {...props}
      remarkPlugins={[remarkMath, [remarkGfm, { singleTilde: false }]]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({
          inline,
          className,
          children,
          ...props
        }: {
          inline?: boolean;
          className?: string;
          children: React.ReactNode;
        }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <CodeBlock language={match[1]} value={String(children).replace(/\n$/, "")} />
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        table({ children }) {
          return <table className="table">{children}</table>;
        },
        th({ children }) {
          return <th className="th">{children}</th>;
        },
        td({ children }) {
          return <td className="td">{children}</td>;
        },
      }}
    />
  );
});

export default MemoizedReactMarkdown;
