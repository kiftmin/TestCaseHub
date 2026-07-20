import { useEffect, useRef, useState } from "react";
import { customFetch } from "../lib/api-client";
import { getToken } from "../lib/auth";
import { toast } from "sonner";

interface UploadResponse {
  fileUrl: string;
  fileName: string;
  fileType: string | null;
  filename?: string;
  originalName?: string;
  mimetype?: string;
  size?: number;
}

interface CameraCaptureProps {
  onUploaded: (url: string) => void;
  onRemoved?: () => void;
  initialUrl?: string | null;
  accept?: string;
  label?: string;
  readOnly?: boolean;
}

const rawBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE = (rawBase?.replace(/\/$/, "") || "http://localhost:3000/api");

/** Normalize stored path to /uploads/<filename>. */
function normalizeUploadPath(serverPath: string): string | null {
  const trimmed = serverPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const m = u.pathname.match(/\/uploads\/([^/\\?]+)$/);
      return m ? `/uploads/${m[1]}` : null;
    } catch {
      return null;
    }
  }
  const m = trimmed.match(/(?:^|\/)uploads\/([^/\\?\s]+)/);
  if (m) return `/uploads/${m[1]}`;
  // bare filename
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return `/uploads/${trimmed}`;
  return null;
}

/**
 * Load an upload with Authorization header and return a blob: URL.
 * <img src="...?token="> is fragile; fetch+blob is reliable.
 */
async function fetchUploadAsBlobUrl(serverPath: string): Promise<string> {
  const path = normalizeUploadPath(serverPath);
  if (!path) throw new Error("Invalid upload path");
  if (path.startsWith("blob:") || path.startsWith("data:")) return path;

  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to load image (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function CameraCapture({
  onUploaded,
  onRemoved,
  initialUrl,
  accept = "image/*",
  label = "Tap to photograph result",
  readOnly = false,
}: CameraCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const revokeBlob = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  const setBlobPreview = (url: string) => {
    revokeBlob();
    blobUrlRef.current = url.startsWith("blob:") ? url : null;
    setPreviewUrl(url);
    setImgFailed(false);
  };

  // Load initial/server photo via authenticated fetch → blob URL
  useEffect(() => {
    if (dismissed || !initialUrl) {
      if (!blobUrlRef.current) setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    setImgFailed(false);

    fetchUploadAsBlobUrl(initialUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setBlobPreview(url);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewUrl(null);
          setImgFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when server path changes
  }, [initialUrl, dismissed]);

  useEffect(() => {
    return () => revokeBlob();
  }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await customFetch<UploadResponse>("/upload", { method: "POST", body: form });
      const url = res.fileUrl ?? (res.filename ? `/uploads/${res.filename}` : "");
      if (!url) throw new Error("Upload succeeded but no file URL was returned");

      const blobUrl = URL.createObjectURL(file);
      setBlobPreview(blobUrl);
      setDismissed(false);
      onUploaded(url);
      toast.success("Photo attached");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  function handleCamera(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
    e.target.value = "";
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
    e.target.value = "";
  }

  function clearPreview() {
    revokeBlob();
    setPreviewUrl(null);
  }

  if (loadingPreview && !previewUrl) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-md flex items-center gap-sm">
        <div className="w-5 h-5 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-on-surface-variant">Loading photo…</span>
      </div>
    );
  }

  if (previewUrl && !imgFailed) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
        <div className="relative bg-surface-container-high">
          <img
            src={previewUrl}
            alt="Step evidence"
            className="w-full max-h-48 object-contain bg-black/5"
            onError={() => setImgFailed(true)}
            onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
            title="Click to open full size"
            style={{ cursor: "zoom-in" }}
          />
          {!readOnly && (
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  clearPreview();
                  setDismissed(false);
                  setImgFailed(false);
                  cameraInputRef.current?.click();
                }}
                className="px-2 py-1 rounded-md bg-surface-container-lowest/95 border border-outline-variant text-xs font-bold text-secondary shadow-sm hover:bg-surface-container-low"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPreview();
                  setDismissed(true);
                  setImgFailed(false);
                  onRemoved?.();
                }}
                className="w-8 h-8 rounded-md bg-surface-container-lowest/95 border border-outline-variant text-error shadow-sm hover:bg-red-50 flex items-center justify-center"
                aria-label="Remove photo"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          )}
        </div>
        <div className="px-sm py-xs text-xs text-on-surface-variant border-t border-outline-variant/60">
          {readOnly ? "Attached photo" : "Photo ready — click image to enlarge"}
        </div>
        {!readOnly && (
          <>
            <input
              ref={cameraInputRef}
              type="file"
              accept={accept}
              capture="environment"
              onChange={handleCamera}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFile}
              className="hidden"
            />
          </>
        )}
      </div>
    );
  }

  if (imgFailed && initialUrl && !dismissed) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-md flex items-center gap-sm">
        <span className="material-symbols-outlined text-on-surface-variant">broken_image</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-on-surface-variant">Preview unavailable</p>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                clearPreview();
                setDismissed(true);
                setImgFailed(false);
                onRemoved?.();
              }}
              className="text-xs font-bold text-error hover:underline mt-0.5"
            >
              Remove
            </button>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              clearPreview();
              setDismissed(false);
              setImgFailed(false);
              cameraInputRef.current?.click();
            }}
            className="text-xs font-bold text-secondary hover:underline"
          >
            Retake
          </button>
        )}
        <input
          ref={cameraInputRef}
          type="file"
          accept={accept}
          capture="environment"
          onChange={handleCamera}
          className="hidden"
        />
      </div>
    );
  }

  if (readOnly) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center gap-sm p-md bg-surface-container-lowest border border-dashed border-outline-variant rounded-lg hover:bg-surface-container transition-colors disabled:opacity-50"
      >
        {uploading ? (
          <div className="w-5 h-5 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="material-symbols-outlined text-secondary">photo_camera</span>
        )}
        <span className="font-label-md text-label-md text-on-surface">{uploading ? "Uploading…" : label}</span>
      </button>
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        onChange={handleCamera}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="text-xs text-on-surface-variant hover:text-secondary underline"
      >
        Attach file instead
      </button>
    </div>
  );
}
