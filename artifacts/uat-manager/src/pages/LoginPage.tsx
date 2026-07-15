import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { customFetch } from "../lib/api-client";
import { setToken, setStoredUser } from "../lib/auth";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

interface LoginResponse {
  token: string;
  user: { id: number; username: string; role: "ADMIN" | "USER" };
}

export function LoginPage() {
  useEffect(() => { document.title = "Login | TestCaseHub"; }, []);
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = new URLSearchParams(window.location.search);
  const rawRedirect = params.get("redirect") || "/dashboard";
  // Only allow same-origin relative paths (block open redirects)
  const redirect =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") && !rawRedirect.includes("://")
      ? rawRedirect
      : "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await customFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      setToken(data.token);
      setStoredUser({ userId: data.user.id, username: data.user.username, role: data.user.role });
      navigate(redirect);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An error occurred";
      const status = (err as Error & { status?: number }).status;
      if (status === 429 || message.toLowerCase().includes("too many")) {
        setError("Too many login attempts. Please wait before trying again.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Left Panel */}
      <div className="hidden lg:flex w-1/2 bg-primary-container relative flex-col justify-between p-xl overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full border-[1px] border-on-primary-fixed-variant" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] rounded-full border-[1px] border-on-primary-fixed-variant" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-sm">
            <div className="w-10 h-10 bg-secondary-container rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-on-secondary-container"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
              </svg>
            </div>
            <span className="font-display-lg text-display-lg text-white font-bold tracking-tight">
              TestCaseHub
            </span>
          </div>
        </div>
        <div className="relative z-10 mb-xl">
          <h1 className="font-display-lg text-[64px] leading-[1.1] text-white font-extrabold mb-md">
            UAT Test Management, Simplified.
          </h1>
          <p className="font-body-base text-on-primary-container max-w-md text-lg">
            The enterprise platform designed for quality assurance
            professionals to manage, execute, and report test cases with
            clinical precision.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-md">
          <div className="flex -space-x-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-10 h-10 rounded-full border-2 border-primary-container bg-surface-container-high"
              />
            ))}
          </div>
          <p className="font-label-sm text-on-primary-container">
            Trusted by 500+ QA Teams
          </p>
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-md bg-surface">
        <div className="w-full max-w-[440px] animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Mobile Logo */}
          <div className="lg:hidden flex justify-center mb-xl">
            <div className="flex items-center gap-sm">
              <div className="w-8 h-8 bg-secondary-container rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-on-secondary-container"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
                </svg>
              </div>
              <span className="font-display-lg text-display-lg-mobile text-primary font-bold">
                TestCaseHub
              </span>
            </div>
          </div>

          <div className="text-center lg:text-left mb-xl">
            <h2 className="font-display-lg text-display-lg-mobile lg:text-display-lg text-on-surface font-bold mb-xs">
              Welcome back
            </h2>
            <p className="font-body-sm text-on-surface-variant">
              Enter your credentials to access your dashboard.
            </p>
          </div>

          {error && (
            <div className="mb-md p-md bg-error-container border border-error/20 rounded-lg flex items-start gap-md">
              <svg
                className="w-5 h-5 text-error shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <p className="font-label-md text-on-error-container text-sm">
                {error}
              </p>
            </div>
          )}

          <form className="space-y-lg" onSubmit={handleSubmit}>
            <Input
              label="Username"
              id="username"
              name="username"
              placeholder="john.doe@enterprise.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            <div className="space-y-xs">
              <div className="flex items-center justify-between">
                <label
                  className="font-label-md text-on-surface-variant block"
                  htmlFor="password"
                >
                  Password
                </label>
                <a
                  className="font-label-sm text-secondary hover:underline transition-colors"
                  href="#"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  className="w-full px-md py-sm pr-xl rounded-lg border border-outline-variant bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 focus:border-secondary transition-all outline-none font-body-base text-on-surface"
                  id="password"
                  name="password"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-md top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              loading={loading}
              className="w-full"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-xl pt-xl border-t border-outline-variant text-center">
            <p className="font-body-sm text-on-surface-variant">
              Don't have an account?{" "}
              <a
                className="font-label-md text-secondary hover:underline"
                href="#"
              >
                Contact your Administrator
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
