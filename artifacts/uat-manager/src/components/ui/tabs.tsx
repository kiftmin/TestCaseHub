import { createContext, useContext, useState, type ReactNode } from "react";

interface TabsContextType {
  active: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within <Tabs>");
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className = "",
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const active = value ?? internal;
  const setActive = (v: string) => {
    if (onValueChange) onValueChange(v);
    else setInternal(v);
  };
  return (
    <TabsContext.Provider value={{ active, onValueChange: setActive }}>
      <div className={className} data-orientation="horizontal">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-xs bg-surface-container p-xs rounded-lg ${className}`}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { active, onValueChange } = useTabs();
  const isActive = active === value;
  return (
    <button
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      onClick={() => onValueChange(value)}
      className={`inline-flex items-center gap-xs px-lg py-sm rounded-md font-label-md transition-all ${
        isActive
          ? "bg-surface-container-lowest text-secondary shadow-sm"
          : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { active } = useTabs();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      data-state={active === value ? "active" : "inactive"}
      className={className}
    >
      {children}
    </div>
  );
}
