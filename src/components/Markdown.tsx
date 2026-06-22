import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div className="group relative my-2">
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded bg-neutral-700/80 px-2 py-0.5 text-xs text-neutral-200 opacity-0 transition group-hover:opacity-100"
      >
        {copied ? "コピー済" : "コピー"}
      </button>
      <pre
        ref={ref}
        className="overflow-x-auto rounded-md bg-[#0d1117] p-3 text-xs leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 break-words text-sm leading-relaxed [&_a]:text-blue-400 [&_a]:underline [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-neutral-700/60 px-1 py-0.5 text-[0.85em]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
