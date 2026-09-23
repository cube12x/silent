import * as React from "react"
import { cn } from "cn"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy } from "lucide-react"

function CodeBlock({ className, children }: React.ComponentProps<"pre">) {
  const ref = React.useRef<HTMLPreElement>(null)
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    const text = ref.current?.innerText ?? ""
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-line bg-ink-0">
      <button type="button" onClick={copy} className="absolute top-1.5 right-1.5 flex h-6 items-center gap-1 rounded-md border border-line bg-ink-2 px-1.5 text-[10px] text-text-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-cyan">
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "copied" : "copy"}
      </button>
      <pre ref={ref} className={cn("mono overflow-x-auto p-3 text-[12px] leading-5", className)}>
        {children}
      </pre>
    </div>
  )
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("markdown text-sm leading-6 text-text-1 [&_a]:text-cyan [&_a]:underline-offset-2 hover:[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-cyan/50 [&_blockquote]:pl-3 [&_blockquote]:text-text-2 [&_code:not(pre_code)]:mono [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:border [&_code:not(pre_code)]:border-line [&_code:not(pre_code)]:bg-ink-2 [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-px [&_code:not(pre_code)]:text-[12px] [&_code:not(pre_code)]:text-cyan [&_h1]:font-heading [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-text-1 [&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-ink-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: CodeBlock }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
