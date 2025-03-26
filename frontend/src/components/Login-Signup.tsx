// src/components/AuthForm.tsx
import { useState } from "react";
import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "../firebase";
import { useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import Layout from "./Layout";

const AuthForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    // If signing up, check if passwords match
    if (!isLogin && password !== confirmPassword) {
      setError("Passwords do not match. Please try again.");
      return;
    }

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        if (!userCredential.user.emailVerified) {
          setMessage("Please verify your email address before logging in.");
          return;
        }
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        setMessage("A verification email has been sent. Please check your inbox and verify your email.");
        return;
      }
      navigate("/");
    } catch (err: unknown) {
      if (err instanceof FirebaseError) {
        switch (err.code) {
          case "auth/email-already-in-use":
            setError("This email is already registered. Please log in or use a different email address.");
            break;
          case "auth/invalid-email":
            setError("The email address is not valid. Please enter a valid email.");
            break;
          default:
            setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  return (
    <Layout>
      <div className="flex flex-col items-center justify-start p-4 flex-grow space-y-6">
        {/* Login/Signup Form */}
        <div className="max-w-md w-full p-8 bg-white shadow-lg rounded-lg mt-8">
          <h2 className="text-2xl font-bold mb-6 text-center [text-shadow:2px_2px_4px_rgba(0,0,0,0.3)]">
            {isLogin ? "Hold'em Tool Login" : "Sign Up"}
          </h2>
          {error && <p className="text-red-500 mb-4">{error}</p>}
          {message && <p className="text-green-500 mb-4">{message}</p>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500 transition duration-200 ease-in-out hover:border-blue-400"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500 transition duration-200 ease-in-out hover:border-blue-400"
            />
            {/* Confirm Password Field for Sign Up */}
            {!isLogin && (
              <div className="relative">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500 transition duration-200 ease-in-out hover:border-blue-400"
                />
                {confirmPassword && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {passwordsMatch ? (
                      // Check icon for matching passwords
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      // X icon for non-matching passwords
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </span>
                )}
              </div>
            )}
            <button
              type="submit"
              className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-200 ease-in-out"
            >
              {isLogin ? "Login" : "Sign Up"}
            </button>
          </form>
          <button
            onClick={() => {
              setIsLogin((prev) => !prev);
              setError(null);
              setMessage(null);
            }}
            className="mt-6 text-blue-500 hover:underline cursor-pointer"
          >
            {isLogin ? "Need an account? Sign Up" : "Already have an account? Login"}
          </button>
        </div>

        {/* Summary and Preview Section */}
        <div className="flex flex-row max-[700px]:flex-col gap-4 w-full justify-center items-center">
          {/* Summary Box */}
          <div className="max-w-sm w-full p-4 bg-white/70 rounded-lg shadow-md">
            <p className="text-gray-800 text-sm">
              Holdemtool is an advanced GTO preflop range tool that guides you on the optimal play for your preflop hands in various situations. Right now, our simulations focus on tournament play with a 1bb ante, and we’re planning to add cash game and ICM simulations soon. Stay tuned!
            </p>
          </div>
          {/* Preview Video */}
          <div className="max-w-sm w-full">
            <video
              className="w-full rounded shadow-md"
              autoPlay
              muted
              loop
              playsInline
              poster="/preview-poster.png"
            >
              <source src="/homepage.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default AuthForm;
