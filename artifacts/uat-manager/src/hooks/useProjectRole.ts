import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import { getStoredUser } from "../lib/auth";

export function useProjectRole(projectId: number | null) {
  const user = getStoredUser();

  const { data } = useQuery({
    queryKey: ["project-role", projectId],
    queryFn: () => customFetch<{ role: string | null }>(`/projects/${projectId}/my-role`),
    enabled: !!user && projectId !== null,
  });

  if (!user || projectId === null) return null;
  if (user.role === "ADMIN") return "ADMIN" as const;

  return data?.role ?? null;
}
