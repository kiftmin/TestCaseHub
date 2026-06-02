interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap: Record<string, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

export function Avatar({
  src,
  alt = "",
  fallback,
  size = "md",
  className = "",
}: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`rounded-full border border-outline-variant object-cover ${sizeMap[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-label-md ${sizeMap[size]} ${className}`}
    >
      {fallback?.charAt(0).toUpperCase() || "?"}
    </div>
  );
}
