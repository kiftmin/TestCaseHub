import { useAuth } from "../../hooks/useAuth";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { DropdownMenu, DropdownMenuItem } from "../ui/dropdown-menu";

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, isAdmin, logout } = useAuth();

  return (
    <header className="flex justify-between items-center h-16 px-lg w-full sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-outline-variant">
      <div className="flex items-center gap-md flex-1">
        <button onClick={onMenuClick} className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="relative w-full max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-body-sm focus:ring-2 focus:ring-secondary/20"
            placeholder="Search projects..."
            type="text"
          />
        </div>
      </div>
      <div className="flex items-center gap-md">
        <button className="p-2 hover:bg-surface-container-low rounded-full transition-colors relative">
          <svg
            className="text-on-surface-variant"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full" />
        </button>
        <button className="p-2 hover:bg-surface-container-low rounded-full transition-colors">
          <svg
            className="text-on-surface-variant"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        <div className="h-8 w-[1px] bg-outline-variant mx-2" />
        <DropdownMenu
          trigger={
            <div className="flex items-center gap-sm cursor-pointer active:opacity-80">
              <Avatar size="sm" fallback={user?.username?.[0]} />
              <div className="hidden lg:block text-left">
                <p className="font-label-md text-label-md text-on-surface leading-none">
                  {user?.username || "User"}
                </p>
                <div className="mt-1">
                  <Badge variant={isAdmin ? "purple" : "blue"}>
                    {isAdmin ? "ADMIN" : "USER"}
                  </Badge>
                </div>
              </div>
            </div>
          }
        >
          <DropdownMenuItem onClick={logout}>Sign Out</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
