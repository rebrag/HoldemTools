import { useState } from "react";
import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "../firebase";
import { useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";

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
          // Optionally, sign the user out
          // await auth.signOut();
          return;
        }
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Send verification email
        await sendEmailVerification(userCredential.user);
        setMessage("A verification email has been sent. Please check your inbox and verify your email.");
        // Optionally sign the user out to prevent unverified access
        // await auth.signOut();
        return;
      }
      // Redirect if authentication is successful and email is verified
      navigate("/");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <div className="auth-container" style={{ maxWidth: 400, margin: "auto", padding: "2rem" }}>
      <h2>{isLogin ? "Login" : "Sign Up"}</h2>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {message && <p style={{ color: "green" }}>{message}</p>}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          style={{ padding: "0.5rem" }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          style={{ padding: "0.5rem" }}
        />
        <button type="submit" style={{ padding: "0.5rem", fontSize: "1rem" }}>
          {isLogin ? "Login" : "Sign Up"}
        </button>
      </form>
      <button
        onClick={() => setIsLogin((prev) => !prev)}
        style={{
          marginTop: "1rem",
          background: "none",
          border: "none",
          color: "blue",
          textDecoration: "underline"
        }}
      >
        {isLogin ? "Need an account? Sign Up" : "Already have an account? Login"}
      </button>
    </div>
  );
};

export default AuthForm;
