import { useRef, useState } from "react";
import { customFetch } from "../lib/api-client";
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
  accept?: string;
  label?: string;
}

export function CameraCapture({ onUploaded, accept = "image/*", label = "Tap to photograph result" }: CameraCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await customFetch<UploadResponse>("/upload", { method: "POST", body: form });
      const url = res.fileUrl ?? res.filename ?? "";
      setThumbnail(URL.createObjectURL(file));
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

  if (thumbnail) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-sm flex items-center gap-sm">
        <img src={thumbnail} alt="Captured" className="w-16 h-16 object-cover rounded" />
        <div className="flex-1 text-xs text-on-surface-variant">Photo ready</div>
        <button
          onClick={() => {
            setThumbnail(null);
            cameraInputRef.current?.click();
          }}
          className="text-xs font-bold text-secondary hover:underline"
        >
          Retake
        </button>
        <button
          onClick={() => setThumbnail(null)}
          className="material-symbols-outlined text-error"
        >
          close
        </button>
      </div>
    );
  }

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
