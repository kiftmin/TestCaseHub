let authTokenGetter: (() => string | null) | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthTokenGetter(fn: () => string | null) {
  authTokenGetter = fn;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function customFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = authTokenGetter ? authTokenGetter() : null;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const err = new Error(error.message || `HTTP ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    throw err;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}
