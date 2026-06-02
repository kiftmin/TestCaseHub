export interface JwtUser {
  userId: number;
  username: string;
  role: "ADMIN" | "USER";
}

export function getToken(): string | null {
  return localStorage.getItem("tch_token");
}

export function setToken(token: string): void {
  localStorage.setItem("tch_token", token);
}

export function removeToken(): void {
  localStorage.removeItem("tch_token");
}

export function getStoredUser(): JwtUser | null {
  const raw = localStorage.getItem("tch_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JwtUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: JwtUser): void {
  localStorage.setItem("tch_user", JSON.stringify(user));
}

export function removeStoredUser(): void {
  localStorage.removeItem("tch_user");
}
