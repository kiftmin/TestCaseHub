import { customFetch as libCustomFetch, setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { getToken, removeToken, removeStoredUser } from "./auth";

const BASE = "http://localhost:3000/api";

setAuthTokenGetter(getToken);
setUnauthorizedHandler(() => {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    removeToken();
    removeStoredUser();
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
