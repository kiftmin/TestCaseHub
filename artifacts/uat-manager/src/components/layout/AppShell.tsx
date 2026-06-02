import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getToken } from "../../lib/auth";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [, navigate] = useLocation();
  const token = getToken();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate("/login?redirect=" + window.location.pathname, { replace: true });
    }
  }, [token, navigate]);

  if (!token) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-surface font-body-base">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="flex-1 lg:ml-[280px] flex flex-col overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto p-lg">
          <div className="max-w-[1200px] mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
