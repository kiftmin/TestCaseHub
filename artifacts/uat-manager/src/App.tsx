import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { queryClient } from "./lib/query-client";
import { getToken } from "./lib/auth";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { DashboardPage } from "./pages/DashboardPage";
import { UsersPage } from "./pages/UsersPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { TestRunDetailPage } from "./pages/TestRunDetailPage";
import { TestRunReportPage } from "./pages/TestRunReportPage";
import { TesterDashboardPage } from "./pages/TesterDashboardPage";
import { TesterScenarioPage } from "./pages/TesterScenarioPage";
import { TesterCasePage } from "./pages/TesterCasePage";
import { TesterProjectRedirect } from "./pages/TesterProjectRedirect";
import { DefectLogPage } from "./pages/DefectLogPage";
import { BugListPage } from "./pages/BugListPage";
import { SignOffCertificatePage } from "./pages/SignOffCertificatePage";
import { UatSummaryPage } from "./pages/UatSummaryPage";
import { AuditTrailPage } from "./pages/AuditTrailPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!token) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
    }
  }, [token, navigate]);

  if (!token) return null;
  return <AppShell>{children}</AppShell>;
}

function RootRedirect() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const token = getToken();
    navigate(token ? "/dashboard" : "/login", { replace: true });
  }, [navigate]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/dashboard">
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        </Route>
        <Route path="/test-runs/:id" component={({ params }) => (
          <ProtectedRoute>
            <TestRunDetailPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/tester">
          <ProtectedRoute>
            <TesterDashboardPage />
          </ProtectedRoute>
        </Route>
        <Route path="/tester/:projectCode" component={({ params }) => (
          <ProtectedRoute>
            <TesterProjectRedirect params={params as { projectCode: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/tester/run/:testRunId" component={({ params }) => (
          <ProtectedRoute>
            <TesterScenarioPage params={params as { testRunId: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/tester/run/:testRunId/scenario/:scenarioId" component={({ params }) => {
          const safe = (params ?? {}) as { testRunId: string; scenarioId: string };
          return (
            <ProtectedRoute>
              <TesterCasePage params={{ testRunId: safe.testRunId, scenarioId: safe.scenarioId ?? "" }} />
            </ProtectedRoute>
          );
        }} />
        <Route path="/tester/run/:testRunId/scenario/:scenarioId/case/:testCaseId" component={({ params }) => (
          <ProtectedRoute>
            <TesterCasePage params={params as { testRunId: string; scenarioId: string; testCaseId: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/uat-summary" component={({ params }) => (
          <ProtectedRoute>
            <UatSummaryPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/audit" component={({ params }) => (
          <ProtectedRoute>
            <AuditTrailPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/defects" component={({ params }) => (
          <ProtectedRoute>
            <DefectLogPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/bugs" component={({ params }) => (
          <ProtectedRoute>
            <BugListPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/sign-off" component={({ params }) => (
          <ProtectedRoute>
            <SignOffCertificatePage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/test-runs/:runId/report" component={({ params }) => (
          <ProtectedRoute>
            <TestRunReportPage params={params as { runId: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/team" component={({ params }) => (
          <ProtectedRoute>
            <ProjectDetailPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/test-runs" component={({ params }) => (
          <ProtectedRoute>
            <ProjectDetailPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id" component={({ params }) => (
          <ProtectedRoute>
            <ProjectDetailPage params={params as { id: string }} />
          </ProtectedRoute>
        )} />
        <Route path="/projects">
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        </Route>
        <Route path="/users">
          <ProtectedRoute>
            <UsersPage />
          </ProtectedRoute>
        </Route>
        <Route path="/" component={RootRedirect} />
        <Route component={NotFoundPage} />
      </Switch>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
