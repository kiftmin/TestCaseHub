import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "../lib/api-client";
import type { Project, TestRun } from "../types/api";

export function TesterProjectRedirect({ params }: { params: { projectCode: string } }) {
  const [, navigate] = useLocation();

  const { data: project } = useQuery({
    queryKey: ["project-by-code", params.projectCode],
    queryFn: () => customFetch<Project>(`/projects/code/${params.projectCode}`),
    enabled: !!params.projectCode,
  });

  const { data: testRuns } = useQuery({
    queryKey: ["project-runs-by-code", params.projectCode],
    queryFn: async () => {
      if (!project) return [] as TestRun[];
      return customFetch<TestRun[]>(`/projects/${project.id}/test-runs`);
    },
    enabled: !!project,
  });

  useEffect(() => {
    document.title = "Redirecting… | TestCaseHub";
  }, []);

  useEffect(() => {
    if (!testRuns) return;
    const active = testRuns.find((r) => r.status === "in_progress" || r.status === "scheduled");
    const target = active ?? testRuns[0];
    if (target) {
      navigate(`/tester/run/${target.id}`, { replace: true });
    } else if (project) {
      navigate(`/tester`, { replace: true });
    }
  }, [testRuns, project, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-md" />
        <p className="text-on-surface-variant font-body-base">Resolving test run…</p>
      </div>
    </div>
  );
}
