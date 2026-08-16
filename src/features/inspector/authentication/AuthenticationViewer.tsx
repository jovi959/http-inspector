import { HeadersViewer } from "@/features/inspector/headers/HeadersViewer";
import type { HeaderEntry } from "@/generated/contracts";

interface AuthenticationViewerProps {
  readonly headers: readonly HeaderEntry[];
}

const authenticationHeaderNames = new Set([
  "api-key",
  "authorization",
  "cookie",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "www-authenticate",
  "x-api-key",
  "x-auth-token",
]);

/** Presents captured authentication/session headers unchanged and in their original order. */
export function AuthenticationViewer({ headers }: AuthenticationViewerProps) {
  const authenticationHeaders = headers.filter((header) => authenticationHeaderNames.has(header.name.toLowerCase()));
  return <HeadersViewer countLabel="authentication headers" emptyMessage="No captured authentication headers." headers={authenticationHeaders} />;
}
