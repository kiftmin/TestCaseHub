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
import { TesterDashboardPage } from "./pages/TesterDashboardPage";
import { DefectLogPage } from "./pages/DefectLogPage";
import { BugListPage } from "./pages/BugListPage";
import { SignOffCertificatePage } from "./pages/SignOffCertificatePage";
import { UatSummaryPage } from "./pages/UatSummaryPage";
import { AuditTrailPage } from "./pages/AuditTrailPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

function RootRedirect() {
  const [, navigate] = useLocation();
  const token = getToken();

  if (token) {
    navigate("/dashboard", { replace: true });
  } else {
    navigate("/login", { replace: true });
  }

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
            <TestRunDetailPage params={params} />
          </ProtectedRoute>
        )} />
        <Route path="/tester">
          <ProtectedRoute>
            <TesterDashboardPage />
          </ProtectedRoute>
        </Route>
        <Route path="/projects/:id/uat-summary" component={({ params }) => (
          <ProtectedRoute>
            <UatSummaryPage />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/audit" component={() => (
          <ProtectedRoute>
            <AuditTrailPage />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/defects" component={({ params }) => (
          <ProtectedRoute>
            <DefectLogPage params={params} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/bugs" component={({ params }) => (
          <ProtectedRoute>
            <BugListPage params={params} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id/sign-off" component={({ params }) => (
          <ProtectedRoute>
            <SignOffCertificatePage params={params} />
          </ProtectedRoute>
        )} />
        <Route path="/projects/:id" component={({ params }) => (
          <ProtectedRoute>
            <ProjectDetailPage params={params} />
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
