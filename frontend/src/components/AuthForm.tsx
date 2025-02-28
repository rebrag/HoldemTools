import { useState } from "react";
import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "../firebase";
import { useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { FirebaseError } from "firebase/app";

const AuthForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

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
          // add other cases as needed...
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

  return (
    <div className="max-w-md mx-auto p-8 bg-white shadow-lg rounded-lg mt-[25%]">
      <h2 className="text-2xl font-bold mb-6 text-center">{isLogin ? "GTO Lite Login" : "Sign Up"}</h2>
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
        <button
          type="submit"
          className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-200 ease-in-out"
        >
          {isLogin ? "Login" : "Sign Up"}
        </button>
      </form>
      <button
        onClick={() => setIsLogin((prev) => !prev)}
        className="mt-6 text-blue-500 hover:underline cursor-pointer"
      >
        {isLogin ? "Need an account? Sign Up" : "Already have an account? Login"}
      </button>
    </div>
  );
};

export default AuthForm;
