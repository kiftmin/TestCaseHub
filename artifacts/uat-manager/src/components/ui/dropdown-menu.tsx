import React, { useState, useRef, useEffect } from "react";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function DropdownMenu({
  trigger,
  children,
  align = "right",
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1 z-50 min-w-[200px] bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg py-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function DropdownMenuItem({
  onClick,
  children,
  className = "",
}: DropdownMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-md py-2 text-body-sm text-on-surface hover:bg-surface-container-high transition-colors ${className}`}
    >
      {children}
    </button>
  );
}
