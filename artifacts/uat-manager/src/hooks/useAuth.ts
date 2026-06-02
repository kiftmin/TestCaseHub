import { useCallback } from "react";
import { useLocation } from "wouter";
import {
  getStoredUser,
  removeToken,
  removeStoredUser,
} from "../lib/auth";

export function useAuth() {
  const [, navigate] = useLocation();
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const isAuthenticated = !!user;

  const logout = useCallback(() => {
    removeToken();
    removeStoredUser();
    navigate("/login");
  }, [navigate]);

  return { user, isAdmin, isAuthenticated, logout };
}
