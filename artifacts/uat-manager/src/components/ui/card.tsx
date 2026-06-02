import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-md ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: CardProps) {
  return <div className={`mb-md ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = "" }: CardProps) {
  return (
    <h3
      className={`font-title-sm text-title-sm text-on-surface ${className}`}
    >
      {children}
    </h3>
  );
}

export function CardContent({ children, className = "" }: CardProps) {
  return <div className={className}>{children}</div>;
}
