import { useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getStoredUser,
  removeToken,
  removeStoredUser,
} from "../lib/auth";

export function useAuth() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const user = getStoredUser();
  const isAdmin = user?.role === "ADMIN";
  const isAuthenticated = !!user;

  const logout = useCallback(() => {
    removeToken();
    removeStoredUser();
    queryClient.clear();
    navigate("/login");
  }, [navigate, queryClient]);

  return { user, isAdmin, isAuthenticated, logout };
}
