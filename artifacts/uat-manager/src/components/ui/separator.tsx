interface SeparatorProps {
  className?: string;
}

export function Separator({ className = "" }: SeparatorProps) {
  return (
    <div
      className={`h-[1px] bg-outline-variant w-full ${className}`}
    />
  );
}
