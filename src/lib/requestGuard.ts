import "server-only";

export type GuardFailure = {
  status: 403 | 413 | 415;
  code: "forbidden_origin" | "payload_too_large" | "unsupported_media_type";
};
const MAX_BODY_BYTES = 2048;

export function guardAccountRequest(request: Request): GuardFailure | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { status: 415, code: "unsupported_media_type" };
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
    return { status: 413, code: "payload_too_large" };
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return { status: 403, code: "forbidden_origin" };
  const origin = request.headers.get("origin");
  if (origin) {
    let matches = false;
    try {
      const source = new URL(origin);
      const target = new URL(request.url);
      const host = request.headers.get("host");
      const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      const sameHost = Boolean(host && source.host === host);
      const sameProtocol =
        source.protocol === target.protocol ||
        (sameHost && Boolean(forwardedProtocol) && source.protocol === `${forwardedProtocol}:`);
      matches = source.origin === target.origin || (sameHost && sameProtocol);
    } catch {
      matches = false;
    }
    if (!matches) return { status: 403, code: "forbidden_origin" };
  }
  if (
    !fetchSite &&
    !origin &&
    process.env.NODE_ENV === "production" &&
    request.headers.get("user-agent")?.includes("Mozilla")
  )
    return { status: 403, code: "forbidden_origin" };
  return null;
}

export function isPayloadTooLarge(text: string): boolean {
  return new TextEncoder().encode(text).length > MAX_BODY_BYTES;
}
