export interface FilterTab<T extends string> {
  key: T;
  label: string;
  count?: number;
  icon?: string;
}

interface FilterTabsProps<T extends string> {
  tabs: FilterTab<T>[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
  size?: "sm" | "md";
}

export function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
  size = "md",
}: FilterTabsProps<T>) {
  const padding = size === "sm" ? "px-md py-xs" : "px-lg py-sm";
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-xs bg-surface-container p-xs rounded-lg ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`inline-flex items-center gap-xs ${padding} rounded-md font-label-md transition-all ${
              isActive
                ? "bg-surface-container-lowest text-secondary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50"
            }`}
          >
            {tab.icon && (
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            )}
            {tab.label}
            {tab.count != null && (
              <span
                className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                  isActive
                    ? "bg-secondary text-on-secondary"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
