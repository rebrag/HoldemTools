// src/components/LoginSignupModal.tsx
import { useState } from "react";
import {
  auth,
  signInWithGoogle,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  FirebaseError,
} from "../firebase";
import { sendEmailVerification } from "firebase/auth";

interface LoginSignupModalProps {
  onClose: () => void;
}

const LoginSignupModal: React.FC<LoginSignupModalProps> = ({ onClose }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  /* ---------- helpers ---------- */
  const passwordsMatch =
    password === confirmPassword && confirmPassword.length > 0;

  /* ---------- form submit ---------- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

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
      onClose(); // success
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
    try {
      const user = await signInWithGoogle();
      if (!user.emailVerified) {
        setMessage("Please verify your email address before logging in.");
        return;
      }
      onClose();
    } catch (err: unknown) {
      if (err instanceof FirebaseError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError(String(err));
    }
  }

  /* ---------- UI ---------- */
  return (
    <>
      {/* screen‑dimming overlay */}
      <div className="fixed inset-0 z-40 bg-black/40 pointer-events-none transition-all" />

      {/* modal container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="relative w-full max-w-md bg-white p-6 rounded-lg shadow-lg">
          {/* close button */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 text-gray-500 hover:text-black text-lg"
          >
            ×
          </button>

          {/* heading */}
          <h2 className="text-xl font-bold mb-4 text-center">
            {isLogin ? "Hold'em Tool Login" : "Create an Account"}
          </h2>

          {/* error / info */}
          {error && <p className="text-red-500 mb-2">{error}</p>}
          {message && <p className="text-green-500 mb-2">{message}</p>}

          {/* form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full px-4 py-2 border rounded"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-4 py-2 border rounded"
            />

            {!isLogin && (
              <div className="relative">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  required
                  className="w-full px-4 py-2 border rounded"
                />
                {confirmPassword && (
                  <span className="absolute right-3 top-3 text-lg">
                    {passwordsMatch ? (
                      <span className="text-green-500">✓</span>
                    ) : (
                      <span className="text-red-500">✕</span>
                    )}
                  </span>
                )}
              </div>
            )}

            <button
              type="submit"
              className="cursor-pointer w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
            >
              {isLogin ? "Login" : "Sign Up"}
            </button>
          </form>

          {/* Google Login */}
          <div className="flex flex-col items-center mt-1">
          <button
            onClick={handleGoogleLogin}
            className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-200 ease-in-out flex items-center justify-center gap-2 w-full mt-2"
          >
            <img src="/google-icon.svg" alt="Google" className="w-5 h-5" />
            <span>Sign in with Google</span>
          </button>
          </div>

          {/* switch link */}
          <p className="mt-3 text-center text-sm">
            {isLogin ? "Need an account?" : "Already have an account?"}
            <button
              onClick={() => {
                setIsLogin((prev) => !prev);
                setError(null);
                setMessage(null);
              }}
              className="ml-2 text-blue-500 hover:underline"
            >
              {isLogin ? "Sign up" : "Login"}
            </button>
          </p>
        </div>
      </div>
    </>
  );
};

export default LoginSignupModal;
