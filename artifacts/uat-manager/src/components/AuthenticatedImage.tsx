import { useEffect, useState } from "react";
import { getToken } from "../lib/auth";

const rawBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE = (rawBase?.replace(/\/$/, "") || "http://localhost:3000/api");

function toApiUploadPath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  if (fileUrl.startsWith("blob:") || fileUrl.startsWith("data:")) return fileUrl;
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    try {
      const u = new URL(fileUrl);
      const m = u.pathname.match(/\/uploads\/([^/\\?]+)$/);
      return m ? `/uploads/${m[1]}` : null;
    } catch {
      return null;
    }
  }
  if (fileUrl.startsWith("/uploads/")) return fileUrl;
  if (fileUrl.startsWith("uploads/")) return `/${fileUrl}`;
  return `/uploads/${fileUrl.replace(/^\/+/, "")}`;
}

/**
 * Renders an upload image using Authorization header (blob URL).
 * Prefer this over <img src={uploadUrl(...)}> which relies on ?token=.
 */
export function AuthenticatedImage({
  fileUrl,
  alt,
  className,
  onClick,
  title,
}: {
  fileUrl: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    setFailed(false);
    setSrc(null);

    const path = toApiUploadPath(fileUrl);
    if (!path) {
      setFailed(true);
      return;
    }
    if (path.startsWith("blob:") || path.startsWith("data:")) {
      setSrc(path);
      return;
    }

    const token = getToken();
    fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(blobUrl);
        else URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [fileUrl]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-container-high text-on-surface-variant ${className ?? ""}`}
        title="Image unavailable"
      >
        <span className="material-symbols-outlined text-[20px]">broken_image</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className={`bg-surface-container-high animate-pulse ${className ?? ""}`} aria-hidden />
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={className}
      onClick={onClick}
      title={title}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}

/** Open an upload in a new tab via authenticated blob download. */
export async function openAuthenticatedUpload(fileUrl: string): Promise<void> {
  const path = toApiUploadPath(fileUrl);
  if (!path) return;
  if (path.startsWith("blob:") || path.startsWith("data:") || path.startsWith("http")) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to open file");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Revoke after a delay so the new tab can load it
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
