import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { openUrl } from "@tauri-apps/plugin-opener";

function openExternal(href?: string) {
  if (!href) return;
  openUrl(href).catch(() => window.open(href, "_blank"));
}

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

// Memoized on `content`: parsing markdown + syntax highlighting is expensive, so
// during streaming (which re-renders the whole message list on every token) only
// the one bubble whose text actually changed re-parses — not every past message.
function Markdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 break-words text-sm leading-relaxed [&_a]:text-blue-400 [&_a]:underline [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                openExternal(href);
              }}
              className="cursor-pointer"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-neutral-700">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-left align-top font-semibold text-neutral-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-neutral-700 px-2 py-1 align-top">{children}</td>
          ),
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

export default memo(Markdown);
