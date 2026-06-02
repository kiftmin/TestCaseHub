import { useLocation } from "wouter";
import { useEffect } from "react";

export function NotFoundPage() {
  const [, navigate] = useLocation();
  useEffect(() => { document.title = "Not Found | TestCaseHub"; }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center">
        <h1 className="font-display-lg text-display-lg text-primary mb-md">
          404
        </h1>
        <p className="text-on-surface-variant font-body-base mb-lg">
          Page not found
        </p>
        <button
          onClick={() => navigate("/dashboard")}
          className="bg-secondary text-on-secondary px-lg py-sm rounded-lg font-label-md hover:opacity-90 transition-all"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
