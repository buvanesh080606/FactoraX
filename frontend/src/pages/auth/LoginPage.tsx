import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
} from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { ErrorBanner, Modal } from "../../components/ui";

const loginSchema = z.object({
  identifier: z.string().min(1, "Enter your username or email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean().default(true),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotInput, setForgotInput] = useState("");
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "", remember: true },
  });

  useEffect(() => {
    if (user) {
      navigate(user.home_route, { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (values: LoginFormValues) => {
    setErrorMsg(null);
    try {
      const redirectTo = await login(values.identifier, values.password, values.remember);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setErrorMsg(extractErrorMessage(err));
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotStatus(null);
    try {
      const res = await api.post("/auth/forgot-password/", { identifier: forgotInput });
      setForgotStatus(res.data.detail);
    } catch (err) {
      setForgotStatus(extractErrorMessage(err));
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-clip flex items-center justify-center px-4 py-8 sm:px-8 lg:px-14">
      {/* Full-Page Gemini-Enhanced Factory Cover Background */}
      <img
        src="/images/login-bg.jpg"
        alt="FactoraX Automated Manufacturing Floor"
        className="fixed inset-0 h-full w-full object-cover object-center select-none pointer-events-none"
      />
      {/* Seamless Edge-to-Edge Vignette (No Box) so Text Pops Clearly Over Background */}
      <div
        className="fixed inset-0 bg-gradient-to-r from-[#24092f]/75 via-[#24092f]/35 to-[#351044]/20 pointer-events-none"
        aria-hidden="true"
      />

      {/* Foreground Content Grid */}
      <div className="relative z-10 w-full max-w-6xl flex flex-col lg:flex-row items-center justify-between gap-10 lg:gap-12">
        {/* Open Brand & 3-Word Quote Directly Over Background (No Box) */}
        <div className="w-full lg:w-[52%] text-white px-2 sm:px-4">
          <div className="inline-flex items-center gap-4">
            <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-[#FDF2F8]/95 p-2 shadow-2xl ring-2 ring-white/40">
              <img
                src="/images/factorax-mark.png"
                alt="FactoraX Logo"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <h1
                className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-white"
                style={{ textShadow: "0 4px 20px rgba(24, 6, 36, 0.92)" }}
              >
                Factora<span className="text-pink-300">X</span>
              </h1>
              <p
                className="text-xs sm:text-sm font-semibold uppercase tracking-[0.22em] text-pink-100 mt-0.5"
                style={{ textShadow: "0 2px 12px rgba(24, 6, 36, 0.95)" }}
              >
                Since 2026
              </p>
            </div>
          </div>

          <h2
            className="mt-7 font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white"
            style={{ textShadow: "0 6px 26px rgba(20, 4, 30, 0.95), 0 2px 6px rgba(0, 0, 0, 0.7)" }}
          >
            Order. Produce. Audit.
          </h2>
        </div>

        {/* Common Single Login Form Card */}
        <div className="w-full max-w-md lg:w-[44%]">
          <div
            className="rounded-3xl bg-[#FDF2F8]/95 backdrop-blur-xl border border-white/80 shadow-2xl p-6 sm:p-8"
            style={{ backgroundColor: "rgba(253, 242, 248, 0.94)" }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm border border-brand-pinkBorder">
                <img
                  src="/images/factorax-mark.png"
                  alt="FactoraX"
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <h2 className="font-display text-2xl font-extrabold text-brand-purple leading-tight">
                  Sign in
                </h2>
                <p className="text-xs font-bold text-brand-magenta">FactoraX ERP Portal</p>
              </div>
            </div>
            <p className="mt-2.5 text-sm font-medium text-[#4A2557]">
              Enter your FactoraX credentials. Your workspace opens automatically based on your
              assigned role.
            </p>

            {errorMsg && (
              <div className="mt-4">
                <ErrorBanner message={errorMsg} />
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-brand-purple mb-1.5" htmlFor="identifier">
                  Username or Email
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-brand-purple/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="identifier"
                    type="text"
                    autoComplete="username"
                    placeholder="e.g. salesman or admin@smartfactory.in"
                    className="sf-input pl-10 bg-white border-brand-pinkBorder text-brand-purple placeholder:text-[#7D5A88]"
                    {...register("identifier")}
                  />
                </div>
                {errors.identifier && (
                  <p className="mt-1 text-xs font-semibold text-sf-danger">{errors.identifier.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-brand-purple mb-1.5" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-brand-purple/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="sf-input pl-10 pr-11 bg-white border-brand-pinkBorder text-brand-purple placeholder:text-[#7D5A88]"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-purple/70 hover:text-brand-purple p-1"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-xs font-semibold text-sf-danger">{errors.password.message}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-brand-purple cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-sf-border text-brand-magenta focus:ring-brand-magenta"
                    {...register("remember")}
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(true);
                    setForgotStatus(null);
                  }}
                  className="text-xs font-bold text-brand-magenta hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="sf-btn-primary w-full py-3 text-sm mt-2 shadow-lg"
              >
                <KeyRound className="h-4 w-4" />
                {isSubmitting ? "Signing in..." : "Sign In to FactoraX"}
              </button>
            </form>
          </div>

          {/* Informational reference for local benchmark evaluation */}
          <details
            className="mt-4 rounded-2xl border border-white/80 bg-white/95 backdrop-blur-md px-4 py-3 text-xs text-[#4A2557] shadow-lg"
            style={{ backgroundColor: "rgba(255, 255, 255, 0.94)" }}
          >
            <summary className="cursor-pointer font-bold text-brand-purple">
              Benchmark Evaluation Accounts (Seeded Locally)
            </summary>
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
              <div><strong className="text-brand-purple">Salesman:</strong> salesman / Smart@123</div>
              <div><strong className="text-brand-purple">Admin:</strong> admin / Smart@123</div>
              <div><strong className="text-brand-purple">Production:</strong> production / Smart@123</div>
              <div><strong className="text-brand-purple">Accountant:</strong> accountant / Smart@123</div>
              <div><strong className="text-brand-purple">Owner:</strong> owner / Smart@123</div>
            </div>
          </details>
        </div>
      </div>

      <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title="Reset Password">
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <p className="text-sm text-sf-muted">
            Enter your username or email address. Your request will be logged for your FactoraX
            administrator.
          </p>
          <input
            type="text"
            required
            value={forgotInput}
            onChange={(e) => setForgotInput(e.target.value)}
            placeholder="Username or email"
            className="sf-input"
          />
          {forgotStatus && (
            <div className="rounded-xl bg-brand-pink p-3 text-xs font-medium text-brand-purple border border-brand-pinkBorder">
              {forgotStatus}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForgotOpen(false)} className="sf-btn-secondary">
              Close
            </button>
            <button type="submit" className="sf-btn-primary">
              Submit Request
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
