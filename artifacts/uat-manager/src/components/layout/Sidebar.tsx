import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "../../hooks/useAuth";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/projects", label: "Projects", icon: "inventory_2" },
];

const projectSubLinks: NavItem[] = [
  { href: "", label: "Test Plan", icon: "assignment" },
  { href: "/team", label: "Team", icon: "group" },
  { href: "/test-runs", label: "Test Runs", icon: "play_circle" },
  { href: "/defects", label: "Defects", icon: "error" },
  { href: "/sign-off", label: "Sign-off", icon: "verified" },
  { href: "/uat-summary", label: "UAT Summary", icon: "analytics" },
  { href: "/audit", label: "Audit", icon: "history" },
];

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [location, navigate] = useLocation();
  const { isAdmin } = useAuth();
  const [, params] = useRoute<{ id: string }>("/projects/:id/*?");
  const projectId = params?.id;

  const baseProjectPath = projectId ? `/projects/${projectId}` : null;

  const isProjectPage = !!baseProjectPath;

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard";
    if (href === "/projects") return location === "/projects" || (isProjectPage && !projectSubLinks.some((s) => s.href && location.includes(s.href)));
    return location.startsWith(href);
  };

  const handleNav = (href: string) => {
    navigate(href);
    onClose();
  };

  const items = [
    ...mainNav,
    ...(isAdmin ? [{ href: "/users", label: "Users", icon: "group" } as NavItem] : []),
    { href: "/tester", label: "My Runs", icon: "play_circle" },
  ];

  const sidebarWidth = collapsed ? "w-[64px]" : "w-[280px]";

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 ${sidebarWidth} border-r border-outline-variant bg-surface flex flex-col transition-all duration-300 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0 lg:static lg:inset-auto`}
    >
      {/* Brand Area */}
      <div className={`flex items-center ${collapsed ? "justify-center" : "gap-md"} px-md pt-md pb-sm ${collapsed ? "" : "mb-lg"}`}>
        <div className="shrink-0 w-9 h-9 bg-primary rounded-lg flex items-center justify-center text-on-primary">
          <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="font-title-sm text-title-sm text-primary leading-none">
              TestCaseHub
            </h1>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-0.5">
              Enterprise UAT
            </p>
          </div>
        )}
        <button onClick={onClose} className="lg:hidden ml-auto p-1 text-on-surface-variant">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-xs overflow-y-auto px-sm">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <a
              key={item.href}
              onClick={(e) => {
                e.preventDefault();
                handleNav(item.href);
              }}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center ${collapsed ? "justify-center" : "gap-md"} px-md py-sm rounded-lg transition-colors duration-200 ease-in-out font-label-md text-label-md cursor-pointer whitespace-nowrap ${
                active
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[20px] shrink-0">
                {item.icon}
              </span>
              {!collapsed && item.label}
            </a>
          );
        })}

        {isProjectPage && (
          <div className={`mt-md pt-md border-t border-outline-variant ${collapsed ? "px-sm" : "px-md"}`}>
            {!collapsed && (
              <p className="mb-xs text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
                Current Project
              </p>
            )}
            {projectSubLinks.map((sub) => {
              const href = `${baseProjectPath}${sub.href}`;
              const active = sub.href === ""
                ? location === baseProjectPath
                : location === href || location.startsWith(href + "/");
              return (
                <a
                  key={sub.href}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav(href);
                  }}
                  href={href}
                  title={collapsed ? sub.label : undefined}
                  className={`flex items-center ${collapsed ? "justify-center" : "gap-md"} px-md py-sm rounded-lg transition-colors duration-200 ease-in-out font-label-md text-label-md cursor-pointer whitespace-nowrap ${
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px] shrink-0">
                    {sub.icon}
                  </span>
                  {!collapsed && sub.label}
                </a>
              );
            })}
          </div>
        )}
      </nav>

      {/* Collapse Toggle */}
      <div className={`px-sm pb-sm border-t border-outline-variant pt-sm mt-sm ${collapsed ? "flex justify-center" : ""}`}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center w-full px-md py-sm rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors font-label-md cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">
            {collapsed ? "chevron_right" : "chevron_left"}
          </span>
          {!collapsed && <span className="ml-md text-label-sm">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
