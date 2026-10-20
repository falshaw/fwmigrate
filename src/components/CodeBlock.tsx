import { Fragment, type ReactNode } from "react";

/**
 * Dark terminal-style block for firewall config text. Dark in both themes.
 * Light-touch highlighting: comments, CLI keywords, quoted strings and
 * addresses. Builds React nodes, never HTML strings.
 */

const KEYWORDS = [
  "set",
  "edit",
  "next",
  "end",
  "config",
  "delete",
  "unset",
  "access-list",
  "access-group",
  "object-group",
  "object",
  "mgmt_cli",
  "add",
  "rule",
  "permit",
  "deny",
  "accept",
  "allow",
  "drop",
  "reject",
];

const TOKEN = new RegExp(
  [
    `(?<str>"[^"]*")`,
    `(?<addr>\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?:\\/\\d{1,2})?\\b)`,
    `(?<kw>(?<![\\w-])(?:${KEYWORDS.map((k) => k.replace(/[-_]/g, "\\$&")).join("|")})(?![\\w-]))`,
  ].join("|"),
  "g",
);

const COMMENT = /^\s*(#|!|\/\/)/;

export function highlightLine(line: string): ReactNode[] {
  if (COMMENT.test(line)) return [<span key="c" className="c">{line}</span>];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const cls = m.groups?.kw ? "k" : "s";
    out.push(
      <span key={i} className={cls}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Trim blank edges and the indent every line shares. */
export function dedent(code: string): string[] {
  const lines = code.replace(/\s+$/, "").replace(/^\n+/, "").split("\n");
  const indents = lines
    .filter((l) => l.trim())
    .map((l) => (l.match(/^[ \t]*/)?.[0].length ?? 0));
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}

export function CodeBlock({
  code,
  label,
  className = "",
  maxHeight,
}: {
  code: string;
  label?: string;
  className?: string;
  maxHeight?: number;
}) {
  const lines = dedent(code);
  return (
    <div className="min-w-0">
      {label && <div className="eyebrow mb-1.5">{label}</div>}
      <pre
        className={`code m-0 ${className}`}
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
        aria-label={label ?? "Configuration"}
      >
        {lines.map((line, i) => (
          <Fragment key={i}>
            {highlightLine(line)}
            {i < lines.length - 1 && "\n"}
          </Fragment>
        ))}
      </pre>
    </div>
  );
}
