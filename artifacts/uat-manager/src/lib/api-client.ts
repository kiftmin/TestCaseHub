import { customFetch as libCustomFetch, setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { getToken, removeToken, removeStoredUser } from "./auth";

const rawBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const BASE = (rawBase?.replace(/\/$/, "") || "http://localhost:3000/api");
export const API_ORIGIN = BASE.replace(/\/api\/?$/, "") || "http://localhost:3000";

setAuthTokenGetter(getToken);
setUnauthorizedHandler(() => {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    removeToken();
    removeStoredUser();
    // Full page navigation clears React Query memory as well
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?redirect=${redirect}`);
  }
});

export async function customFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  return libCustomFetch<T>(`${BASE}${path}`, options);
}

/**
 * Absolute URL for an upload path returned by the API (e.g. /uploads/xyz.png).
 * Uses authenticated /api/uploads/:file?token= so <img> and window.open work.
 */
export function uploadUrl(fileUrl: string | null | undefined): string {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) return fileUrl;
  const token = getToken();
  const tokenQ = token ? `?token=${encodeURIComponent(token)}` : "";
  if (fileUrl.startsWith("/uploads/")) {
    return `${BASE}${fileUrl}${tokenQ}`;
  }
  return `${API_ORIGIN}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
}
