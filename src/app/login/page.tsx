"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearCachedCenter } from "@/lib/centerProfile";
import {
  ShieldCheck,
  Building2,
  Phone,
  Lock,
  ArrowRight,
  Loader2,
  AlertCircle,
  Sparkles,
  User,
  BookOpen,
  Eye,
  EyeOff,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");

  // Login form state
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [registerName, setRegisterName] = useState("");
  const [registerOwnerName, setRegisterOwnerName] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invalidate any stale in-memory center profile on login route mount
  useEffect(() => {
    clearCachedCenter();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = loginPhone.trim().replace(/\s+/g, "");
    if (!cleanPhone) {
      setError("Please enter your registered phone number.");
      return;
    }

    if (cleanPhone.length < 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    if (!loginPassword) {
      setError("Please enter your account password.");
      return;
    }

    setLoading(true);
    clearCachedCenter();

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: cleanPhone,
          password: loginPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        clearCachedCenter();
        throw new Error(data.error || "Invalid phone number or password.");
      }

      if (data.center?.centerId) {
        localStorage.setItem("user_center_id", data.center.centerId);
      }
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
      }

      clearCachedCenter();
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      clearCachedCenter();
      const msg =
        err instanceof Error ? err.message : "Unable to login. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = registerName.trim();
    const cleanOwnerName = registerOwnerName.trim();
    const cleanPhone = registerPhone.trim().replace(/\s+/g, "");

    if (
      !cleanName ||
      !cleanOwnerName ||
      !cleanPhone ||
      !registerPassword
    ) {
      setError("Please fill out all fields including password to register.");
      return;
    }

    if (cleanPhone.length < 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    if (registerPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    clearCachedCenter();

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          ownerName: cleanOwnerName,
          phone: cleanPhone,
          password: registerPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        clearCachedCenter();
        throw new Error(data.error || "Registration failed.");
      }

      if (data.center?.centerId) {
        localStorage.setItem("user_center_id", data.center.centerId);
      }
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
      }

      clearCachedCenter();
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      clearCachedCenter();
      const msg =
        err instanceof Error
          ? err.message
          : "Registration failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-4 py-8 bg-gradient-to-b from-slate-50 via-white to-blue-50/30">
      <div className="w-full max-w-sm mx-auto">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/25 mb-3 ring-4 ring-blue-100">
            <ShieldCheck className="h-7 w-7 stroke-[2.2]" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            TuitionDesk
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Smart Multi-Tenant Tuition Center Management
          </p>
        </div>

        {/* Card Container */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 backdrop-blur-sm">
          {/* Mode Switcher Toggle */}
          <div className="p-1 rounded-2xl bg-slate-100 grid grid-cols-2 gap-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`tap-bounce flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                mode === "login"
                  ? "bg-white text-blue-700 shadow-sm shadow-slate-200 scale-[1.01]"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Owner Login</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
              }}
              className={`tap-bounce flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                mode === "register"
                  ? "bg-white text-blue-700 shadow-sm shadow-slate-200 scale-[1.01]"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Register Center</span>
            </button>
          </div>

          {/* Form */}
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-phone"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5"
                >
                  Registered Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
                    <Phone className="h-4 w-4 mr-1.5 text-slate-400" />
                    <span>+91</span>
                  </div>
                  <input
                    id="login-phone"
                    type="tel"
                    value={loginPhone}
                    onChange={(e) => {
                      setLoginPhone(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="9876543210"
                    autoComplete="tel"
                    maxLength={10}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-16 pr-4 py-3 text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all font-mono tracking-wide"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    id="login-password"
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter your account password"
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-11 py-3 text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:bg-white focus:border-blue-600 focus:outline-hidden focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={
                      showLoginPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showLoginPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-800 flex items-start gap-2.5 text-xs animate-shake">
                  <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span className="font-semibold leading-tight">{error}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="tap-bounce w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 stroke-[2.2]" />
                    <span>Log In to Center</span>
                    <ArrowRight className="h-4 w-4 ml-0.5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Tuition Center Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <input
                    id="reg-name"
                    type="text"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    placeholder="e.g. Apex Tutorials"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-owner-name"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Owner / Principal Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="h-4 w-4" />
                  </div>
                  <input
                    id="reg-owner-name"
                    type="text"
                    value={registerOwnerName}
                    onChange={(e) => setRegisterOwnerName(e.target.value)}
                    placeholder="e.g. Prof. Rajesh Sharma"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-phone"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
                    <Phone className="h-3.5 w-3.5 mr-1 text-slate-400" />
                    <span>+91</span>
                  </div>
                  <input
                    id="reg-phone"
                    type="tel"
                    value={registerPhone}
                    onChange={(e) => setRegisterPhone(e.target.value)}
                    placeholder="9812345678"
                    maxLength={10}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-14 pr-3.5 py-2.5 text-xs font-bold text-slate-900 font-mono focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Password (min 6 characters)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    id="reg-password"
                    type={showRegisterPassword ? "text" : "password"}
                    value={registerPassword}
                    onChange={(e) => {
                      setRegisterPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Create a secure password"
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-10 pr-10 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowRegisterPassword(!showRegisterPassword)
                    }
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={
                      showRegisterPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showRegisterPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-800 flex items-start gap-2.5 text-xs animate-shake">
                  <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <span className="font-semibold leading-tight">{error}</span>
                </div>
              )}

              {/* Submit Register Button */}
              <button
                type="submit"
                disabled={loading}
                className="tap-bounce w-full h-11 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-60 mt-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating Center...</span>
                  </>
                ) : (
                  <>
                    <Building2 className="h-4 w-4" />
                    <span>Create Center &amp; Launch</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Security Footer */}
        <div className="text-center mt-6 text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3 text-slate-400" />
          <span>Multi-Tenant Enterprise Session (JWT + HttpOnly)</span>
        </div>
      </div>
    </div>
  );
}
