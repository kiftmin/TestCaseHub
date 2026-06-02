export interface JwtUser {
  userId: number;
  username: string;
  role: "ADMIN" | "USER";
}

export function getToken(): string | null {
  return localStorage.getItem("tch_token");
}

export function setToken(token: string) {
  localStorage.setItem("tch_token", token);
}

export function removeToken() {
  localStorage.removeItem("tch_token");
}

export function getStoredUser(): JwtUser | null {
  const user = localStorage.getItem("tch_user");
  return user ? JSON.parse(user) : null;
}

export function setStoredUser(user: JwtUser) {
  localStorage.setItem("tch_user", JSON.stringify(user));
}

export function removeStoredUser() {
  localStorage.removeItem("tch_user");
}
