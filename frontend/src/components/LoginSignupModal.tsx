// src/components/LoginSignupModal.tsx
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Mail, Lock, X, Check } from "lucide-react";
import {
  auth,
  signInWithGoogle,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  FirebaseError,
} from "@/lib/firebase";
import { sendEmailVerification } from "firebase/auth";
import useWindowDimensions from "@/hooks/useWindowDimensions";
import { DEV_AUTH_BYPASS, devAuthSignIn } from "@/lib/devAuth";

interface LoginSignupModalProps {
  onClose: () => void;
  /** Called on a successful sign-in (not on plain dismiss). Falls back to
   *  onClose when omitted, so existing call sites keep working unchanged. */
  onSuccess?: () => void;
}

const LoginSignupModal: React.FC<LoginSignupModalProps> = ({ onClose, onSuccess }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // Where to route a successful sign-in. Defaults to onClose so nothing changes
  // for callers that don't need the distinction.
  const finishSuccess = onSuccess ?? onClose;

  const { windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const isMobile = windowWidth < 640; // Tailwind `sm` breakpoint

  /* ---------- helpers ---------- */
  const passwordsMatch =
    password === confirmPassword && confirmPassword.length > 0;

  /* ---------- close on Escape + lock body scroll ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  /* ---------- form submit ---------- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    // Dev-only: skip Firebase and sign in the dummy user so the flow is testable.
    if (DEV_AUTH_BYPASS) {
      devAuthSignIn();
      finishSuccess();
      return;
    }

    if (!isLogin && !passwordsMatch) {
      setError("Passwords do not match. Please try again.");
      return;
    }

    try {
      if (isLogin) {
        const { user } = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
        if (!user.emailVerified) {
          setMessage("Please verify your email address before logging in.");
          return;
        }
      } else {
        const { user } = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await sendEmailVerification(user);
        setMessage(
          "A verification email has been sent. Please check your inbox and verify your email."
        );
        return; // stop here; user must verify first
      }
      finishSuccess(); // login success
    } catch (err: unknown) {
      if (err instanceof FirebaseError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError(String(err));
    }
  }

  /* ---------- google sign‑in ---------- */
  async function handleGoogleLogin() {
    setError(null);
    setMessage(null);
    // Dev-only: skip the Google popup and sign in the dummy user.
    if (DEV_AUTH_BYPASS) {
      devAuthSignIn();
      finishSuccess();
      return;
    }
    try {
      const user = await signInWithGoogle();
      if (!user.emailVerified) {
        setMessage("Please verify your email address before logging in.");
        return;
      }
      finishSuccess();
    } catch (err: unknown) {
      if (err instanceof FirebaseError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError(String(err));
    }
  }

  /* ---------- entrance motion (slide-up on mobile, scale on desktop) ------- */
  const panelVariants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.1 } },
      }
    : isMobile
    ? {
        hidden: { opacity: 0, y: 48 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
        },
        exit: { opacity: 0, y: 48, transition: { duration: 0.2 } },
      }
    : {
        hidden: { opacity: 0, scale: 0.96, y: 8 },
        show: {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
        },
        exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
      };

  /* ---------- UI ---------- */
  return (
    <AnimatePresence>
      {/* screen‑dimming, click‑to‑close backdrop */}
      <motion.div
        key="backdrop"
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* positioning wrapper — bottom sheet on mobile, centered on desktop */}
      <div className="fixed inset-0 z-50 flex justify-center items-end sm:items-center pointer-events-none">
        <motion.div
          key="panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-modal-title"
          variants={panelVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="
            pointer-events-auto relative
            w-full rounded-t-3xl px-5 pt-3 pb-8
            sm:w-full sm:max-w-md sm:rounded-2xl sm:m-4 sm:px-8 sm:py-8
            bg-surface/80 backdrop-blur-xl border border-hairline
            shadow-2xl text-slate-100
            max-h-[92vh] overflow-y-auto
          "
        >
          {/* mobile grab handle */}
          <div className="sm:hidden mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20" />

          {/* close button */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 sm:right-4 sm:top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={16} strokeWidth={2.2} />
          </button>

          {/* heading */}
          <div className="mb-5 text-center">
            <h2
              id="login-modal-title"
              className="text-2xl font-bold tracking-tight text-white"
            >
              {isLogin ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {isLogin
                ? "Sign in to continue to HoldemTools."
                : "Join HoldemTools to unlock your solver."}
            </p>
          </div>

          {/* error / info banners */}
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {message && (
            <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {message}
            </div>
          )}

          {/* form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-hairline bg-white/5 py-3 pl-11 pr-4 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/60"
              />
            </div>

            <div className="relative">
              <Lock
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete={isLogin ? "current-password" : "new-password"}
                className="w-full rounded-xl border border-hairline bg-white/5 py-3 pl-11 pr-4 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/60"
              />
            </div>

            {!isLogin && (
              <div className="relative">
                <Lock
                  size={18}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-hairline bg-white/5 py-3 pl-11 pr-10 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/60"
                />
                {confirmPassword && (
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {passwordsMatch ? (
                      <Check size={18} className="text-emerald-400" />
                    ) : (
                      <X size={18} className="text-red-400" />
                    )}
                  </span>
                )}
              </div>
            )}

            <button
              type="submit"
              className="mt-1 w-full cursor-pointer rounded-xl bg-accent py-3 font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              {isLogin ? "Login" : "Sign Up"}
            </button>
          </form>

          {/* divider */}
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              or continue with
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>

          {/* Google Login */}
          <button
            onClick={handleGoogleLogin}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-hairline bg-white/5 py-3 font-medium text-slate-100 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <img src="/google-icon.svg" alt="" className="h-5 w-5" />
            <span>Sign in with Google</span>
          </button>

          {/* switch link */}
          <p className="mt-5 text-center text-sm text-slate-400">
            {isLogin ? "Need an account?" : "Already have an account?"}
            <button
              onClick={() => {
                setIsLogin((prev) => !prev);
                setError(null);
                setMessage(null);
              }}
              className="ml-2 font-semibold text-accent hover:underline"
            >
              {isLogin ? "Sign up" : "Login"}
            </button>
          </p>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default LoginSignupModal;
