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

/**
 * Returns true when the current user is a QA-flagged developer on this project.
 * Shares the ["project-role", projectId] query with useProjectRole so only one
 * request is made. ADMIN resolves to false on purpose — QA actions require the
 * explicit is_qa flag even when an admin is acting on a QA person's behalf.
 */
export function useIsProjectQa(projectId: number | null): boolean {
  const user = getStoredUser();

  const { data } = useQuery({
    queryKey: ["project-role", projectId],
    queryFn: () => customFetch<ProjectRoleResponse>(`/projects/${projectId}/my-role`),
    enabled: !!user && projectId !== null,
  });

  if (!user || projectId === null) return false;
  if (user.role === "ADMIN") return false;

  return data?.isQa ?? false;
}
