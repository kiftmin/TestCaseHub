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
  { href: "/bugs", label: "Bugs", icon: "bug_report" },
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

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-[280px] border-r border-outline-variant bg-surface flex flex-col p-md gap-sm transition-transform duration-300 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0 lg:static lg:inset-auto`}
    >
      <div className="flex items-center gap-md mb-xl">
        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-on-primary">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
        </div>
        <div>
          <h1 className="font-title-sm text-title-sm text-primary leading-none">
            TestCaseHub
          </h1>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">
            Enterprise UAT
          </p>
        </div>
        <button onClick={onClose} className="lg:hidden ml-auto p-1 text-on-surface-variant">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <nav className="flex-1 flex flex-col gap-xs overflow-y-auto">
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
              className={`flex items-center gap-md px-md py-sm rounded-lg transition-colors duration-200 ease-in-out font-label-md text-label-md cursor-pointer ${
                active
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {item.icon}
              </span>
              {item.label}
            </a>
          );
        })}

        {isProjectPage && (
          <div className="mt-md pt-md border-t border-outline-variant">
            <p className="px-md mb-xs text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
              Current Project
            </p>
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
                  className={`flex items-center gap-md px-md py-sm rounded-lg transition-colors duration-200 ease-in-out font-label-md text-label-md cursor-pointer ${
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {sub.icon}
                  </span>
                  {sub.label}
                </a>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
}
