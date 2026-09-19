import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";

export interface ProjectRoleResponse {
  role: string | null;
  isQa?: boolean;
}

export function useProjectRole(projectId: number | null) {
  const user = getStoredUser();

  const { data } = useQuery({
    queryKey: ["project-role", projectId],
    queryFn: () => customFetch<ProjectRoleResponse>(`/projects/${projectId}/my-role`),
    enabled: !!user && projectId !== null,
  });

  if (!user || projectId === null) return null;
  if (user.role === "ADMIN") return "ADMIN" as const;

  return data?.role ?? null;
}

export function useIsProjectQa(projectId: number | null): boolean {
  const user = getStoredUser();

  const { data } = useQuery({
    queryKey: ["project-role", projectId],
    queryFn: () => customFetch<ProjectRoleResponse>(`/projects/${projectId}/my-role`),
    enabled: !!user && projectId !== null,
  });

  if (!user || projectId === null) return false;
  if (user.role === "ADMIN") return true;

  return data?.isQa ?? false;
}
