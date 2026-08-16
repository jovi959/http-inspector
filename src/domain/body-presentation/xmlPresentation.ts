export type XmlPresentation =
  | { readonly kind: "valid"; readonly original: string; readonly pretty: string }
  | { readonly kind: "invalid"; readonly original: string; readonly diagnostics: readonly string[] };

/** Formats XML without changing the captured source retained for copy and raw views. */
export function createXmlPresentation(original: string): XmlPresentation {
  const tokens = tokenize(original);
  if (tokens === null) return { kind: "invalid", original, diagnostics: ["The XML markup is incomplete; the original content is preserved."] };
  const pretty = format(tokens);
  return pretty === null
    ? { kind: "invalid", original, diagnostics: ["The XML element structure is incomplete; the original content is preserved."] }
    : { kind: "valid", original, pretty };
}

export function isXmlCandidate(contentType: string | null): boolean {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "application/xml" || normalized === "text/xml" || normalized.endsWith("+xml");
}

function tokenize(value: string): readonly string[] | null {
  const tokens: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "<") {
      const next = value.indexOf("<", index);
      tokens.push(value.slice(index, next === -1 ? value.length : next));
      index = next === -1 ? value.length : next;
      continue;
    }

    const end = markupEnd(value, index);
    if (end === -1) return null;
    tokens.push(value.slice(index, end + 1));
    index = end + 1;
  }
  return tokens;
}

function markupEnd(value: string, start: number): number {
  if (value.startsWith("<!--", start)) return endingIndex(value, "-->", start + 4, 2);
  if (value.startsWith("<![CDATA[", start)) return endingIndex(value, "]]>", start + 9, 2);
  if (value.startsWith("<?", start)) return endingIndex(value, "?>", start + 2, 1);

  let quote: string | null = null;
  for (let index = start + 1; index < value.length; index++) {
    const character = value[index]!;
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function endingIndex(value: string, ending: string, start: number, offset: number): number {
  const index = value.indexOf(ending, start);
  return index === -1 ? -1 : index + offset;
}

function format(tokens: readonly string[]): string | null {
  const lines: string[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = token.trim();
      if (text) lines.push(`${indent(depth)}${text}`);
      continue;
    }

    if (token.startsWith("</")) {
      if (depth === 0) return null;
      depth--;
      lines.push(`${indent(depth)}${token}`);
      continue;
    }

    lines.push(`${indent(depth)}${token}`);
    if (!isSelfClosing(token) && !isMarkupDeclaration(token)) depth++;
  }
  return depth === 0 ? lines.join("\n") : null;
}

function isSelfClosing(token: string): boolean {
  return /\/\s*>$/.test(token);
}

function isMarkupDeclaration(token: string): boolean {
  return token.startsWith("<?") || token.startsWith("<!--") || token.startsWith("<![CDATA[") || token.startsWith("<!");
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}
