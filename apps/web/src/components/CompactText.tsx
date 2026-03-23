import { memo, useMemo, useState } from "react";

type CompactTextProps = {
  text: string;
  maxChars?: number;
  as?: "span" | "p" | "code";
  className?: string;
  mono?: boolean;
};

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export const CompactText = memo(function CompactText({
  text,
  maxChars = 180,
  as = "span",
  className,
  mono = false,
}: CompactTextProps) {
  const normalized = useMemo(() => (text ?? "").trim(), [text]);
  const [expanded, setExpanded] = useState(false);

  if (!normalized) {
    return null;
  }

  const canCollapse = normalized.length > maxChars;
  const display = expanded || !canCollapse ? normalized : truncateText(normalized, maxChars);
  const Tag = as;

  return (
    <span className="compactTextWrap">
      <Tag className={`${className ?? ""}${mono ? " compactTextMono" : ""}`.trim()}>{display}</Tag>
      {canCollapse ? (
        <button type="button" className="compactToggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </span>
  );
});
