import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method?: string;
  url?: string;
  user?: string | null;
  component?: string;
  startedAt?: number;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, handler: () => T): T {
  return requestContextStorage.run(context, handler);
}

export function getRequestContext() {
  return requestContextStorage.getStore();
}

function maskValue(value: unknown) {
  if (typeof value !== "string") return value;
  if (value.length <= 12) return "[REDACTED]";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function maskHeaders(headers: Record<string, unknown> | undefined) {
  if (!headers) return headers;

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("authorization") || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("cookie")) {
      masked[key] = maskValue(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

export function logDebug(message: string, details: Record<string, unknown> = {}) {
  const context = getRequestContext();
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "debug",
      requestId: context?.requestId,
      method: context?.method,
      url: context?.url,
      component: context?.component,
      user: context?.user,
      message,
      ...details,
    }),
  );
}

export function logError(message: string, details: Record<string, unknown> = {}) {
  const context = getRequestContext();
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId: context?.requestId,
      method: context?.method,
      url: context?.url,
      component: context?.component,
      user: context?.user,
      message,
      ...details,
    }),
  );
}
