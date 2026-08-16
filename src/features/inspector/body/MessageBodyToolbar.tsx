import { formatBytes } from "@/domain/display/bytePresentation";
import type { HttpBody } from "@/generated/contracts";

interface MessageBodyToolbarProps {
  readonly body: HttpBody | null;
  readonly rawFidelity: string | null;
}

/** Shows captured-body facts without assuming that unavailable content is empty. */
export function MessageBodyToolbar({ body, rawFidelity }: MessageBodyToolbarProps) {
  if (!body) return <p className="body-facts">No body was captured for this message.</p>;
  const facts = [
    body.mediaType ?? "Unknown media type",
    body.charset ?? "Unknown charset",
    `Captured ${formatBytes(body.capturedByteLength)}`,
    body.availability,
  ];
  if (body.declaredByteLength !== null) facts.push(`Declared ${formatBytes(body.declaredByteLength)}`);
  if (body.observedByteLength !== null) facts.push(`Observed ${formatBytes(body.observedByteLength)}`);
  if (body.truncationReason) facts.push(`Truncated: ${body.truncationReason}`);
  if (rawFidelity) facts.push(`Raw: ${rawFidelity}`);
  return <p className="body-facts">{facts.join(" · ")}</p>;
}
