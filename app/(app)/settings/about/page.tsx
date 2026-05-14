import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const dynamic = "force-dynamic";

// Renders USER_GUIDE.md from the repo root. Single source of truth:
// the same file is the GitHub-facing README at /USER_GUIDE.md, so any
// edit there ships to both surfaces in the same commit.
//
// The file is read on every request (file is small, ~50 KB; no point
// caching). If the file is missing for any reason — wrong cwd in a
// future deploy, accidental delete — we render a friendly fallback
// instead of 500'ing the page.
async function loadGuide(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "USER_GUIDE.md"), "utf8");
  } catch {
    return "# User guide\n\nGuide file not found at repo root.";
  }
}

export default async function AboutPage() {
  const markdown = await loadGuide();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/settings" className="text-sm text-blush-600 hover:underline">← Settings</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">About this app</h1>
        <p className="text-sm text-stone-500">
          Complete walkthrough of every feature. Lives at <code className="text-xs">USER_GUIDE.md</code> in the repo so a single edit ships to both.
        </p>
      </div>

      <article className="card max-w-3xl space-y-4 p-6 text-sm leading-relaxed text-stone-700">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // Tailwind-styled markdown elements. We don't use the
          // typography plugin because it pulls a separate dep + tints
          // colours away from the blush/cream palette.
          components={{
            h1: ({ children }) => (
              <h1 className="mt-2 font-display text-3xl text-blush-700">{children}</h1>
            ),
            h2: ({ children, id }) => (
              <h2 id={id} className="mt-8 border-t border-stone-100 pt-4 font-display text-2xl text-stone-800">
                {children}
              </h2>
            ),
            h3: ({ children, id }) => (
              <h3 id={id} className="mt-4 font-display text-lg text-stone-800">
                {children}
              </h3>
            ),
            p: ({ children }) => <p className="text-sm text-stone-700">{children}</p>,
            ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li className="text-sm text-stone-700">{children}</li>,
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-blush-600 underline decoration-blush-200 underline-offset-2 hover:decoration-blush-500"
                target={href?.startsWith("http") ? "_blank" : undefined}
                rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                {children}
              </a>
            ),
            code: ({ children }) => (
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs text-stone-800">
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="my-2 overflow-x-auto rounded-xl bg-stone-100 p-3 text-xs leading-snug text-stone-800">
                {children}
              </pre>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-2 border-l-2 border-blush-300 pl-3 italic text-stone-600">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-4 border-stone-200" />,
            // Tables — react-markdown w/ remark-gfm parses pipe-tables.
            // Wrap in a horizontal scroll container for narrow screens.
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-stone-50">{children}</thead>,
            th: ({ children }) => (
              <th className="border border-stone-200 px-2 py-1 text-left font-medium text-stone-700">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-stone-200 px-2 py-1 align-top text-stone-700">
                {children}
              </td>
            ),
            strong: ({ children }) => (
              <strong className="font-medium text-stone-900">{children}</strong>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
