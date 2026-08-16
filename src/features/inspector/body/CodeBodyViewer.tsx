interface CodeBodyViewerProps {
  readonly content: string;
  readonly preserveHttpLines?: boolean;
}

/** Plain text and raw views preserve captured source exactly in a safe text container. */
export function CodeBodyViewer({ content, preserveHttpLines = false }: CodeBodyViewerProps) {
  return <pre className={`code-body-viewer ${preserveHttpLines ? "is-raw" : ""}`}>{content}</pre>;
}
