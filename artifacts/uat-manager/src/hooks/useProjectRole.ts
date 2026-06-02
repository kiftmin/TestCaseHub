import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";
import type { ProjectAssignment } from "../types/api";

export function useProjectRole(projectId: number | null) {
  const user = getStoredUser();
  const userId = user?.userId;

  const { data } = useQuery({
    queryKey: ["user-projects", userId],
    queryFn: () => customFetch<ProjectAssignment[]>(`/users/${userId}/projects`),
    enabled: !!userId && projectId !== null,
  });

  if (!userId || projectId === null) return null;
  if (user!.role === "ADMIN") return "ADMIN" as const;

  const assignment = data?.find((a) => a.project_id === projectId);
  return assignment?.role ?? null;
}
