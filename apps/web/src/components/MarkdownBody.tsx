import { Fragment, type ReactNode } from "react";

/**
 * Lightweight markdown body renderer for Copilot summary output.
 * Handles: code fences, inline code, bold, italic, bullet/numbered lists, links.
 * XSS-safe — renders React elements, never uses dangerouslySetInnerHTML.
 */

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; children: InlineToken[] }
  | { type: "italic"; children: InlineToken[] }
  | { type: "link"; href: string; text: string };

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code: `...`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push({ type: "code", value: codeMatch[1]! });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **...**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      tokens.push({ type: "bold", children: tokenizeInline(boldMatch[1]!) });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *...*  (but not **)
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      tokens.push({ type: "italic", children: tokenizeInline(italicMatch[1]!) });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      tokens.push({ type: "link", href: linkMatch[2]!, text: linkMatch[1]! });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text: consume up to the next special character
    const nextSpecial = remaining.slice(1).search(/[`*[\]]/);
    if (nextSpecial === -1) {
      tokens.push({ type: "text", value: remaining });
      break;
    }
    tokens.push({ type: "text", value: remaining.slice(0, nextSpecial + 1) });
    remaining = remaining.slice(nextSpecial + 1);
  }

  return tokens;
}

function renderInlineTokens(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (token.type) {
      case "text":
        return <Fragment key={key}>{token.value}</Fragment>;
      case "code":
        return <code key={key} className="mdInlineCode">{token.value}</code>;
      case "bold":
        return <strong key={key}>{renderInlineTokens(token.children, key)}</strong>;
      case "italic":
        return <em key={key}>{renderInlineTokens(token.children, key)}</em>;
      case "link": {
        const isSafeHref = /^https?:\/\//i.test(token.href) || token.href.startsWith("/") || token.href.startsWith("#");
        return <a key={key} href={isSafeHref ? token.href : "#"} target="_blank" rel="noopener noreferrer" className="mdLink">{token.text}</a>;
      }
    }
  });
}

function renderInline(text: string, keyPrefix: string): ReactNode {
  const tokens = tokenizeInline(text);
  return <Fragment key={keyPrefix}>{renderInlineTokens(tokens, keyPrefix)}</Fragment>;
}

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "code"; lang: string; content: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "numbered-list"; items: string[] }
  | { type: "heading"; level: number; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines between blocks
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Code fence: ```
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    // Heading: # ... ## ... ### ...
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1]!.length, text: headingMatch[2]! });
      i++;
      continue;
    }

    // Bullet list: - item or * item
    if (/^[\s]*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[\s]*[-*]\s/, ""));
        i++;
      }
      blocks.push({ type: "bullet-list", items });
      continue;
    }

    // Numbered list: 1. item
    if (/^[\s]*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[\s]*\d+\.\s/, ""));
        i++;
      }
      blocks.push({ type: "numbered-list", items });
      continue;
    }

    // Paragraph — collect consecutive non-blank, non-special lines
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.trimStart().startsWith("```") &&
      !/^#{1,3}\s/.test(lines[i]!) &&
      !/^[\s]*[-*]\s/.test(lines[i]!) &&
      !/^[\s]*\d+\.\s/.test(lines[i]!)
    ) {
      paragraphLines.push(lines[i]!);
      i++;
    }
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
    }
  }

  return blocks;
}

export function MarkdownBody({ text }: { text: string }) {
  if (!text.trim()) {
    return null;
  }

  const blocks = parseBlocks(text);

  return (
    <div className="summaryBody">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={i} className="summaryBodyParagraph">
                {block.lines.flatMap((line, j) =>
                  j > 0
                    ? [<br key={`br-${i}-${j}`} />, renderInline(line, `p-${i}-${j}`)]
                    : [renderInline(line, `p-${i}-${j}`)]
                )}
              </p>
            );
          case "code":
            return (
              <pre key={i} className="mdCodeBlock">
                <code>{block.content}</code>
              </pre>
            );
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
            return <Tag key={i} className="mdHeading">{renderInline(block.text, `h-${i}`)}</Tag>;
          }
          case "bullet-list":
            return (
              <ul key={i} className="mdList">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `ul-${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case "numbered-list":
            return (
              <ol key={i} className="mdList">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `ol-${i}-${j}`)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
