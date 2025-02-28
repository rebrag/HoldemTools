// src/components/VerifyEmailPrompt.tsx
import { useState } from "react";
import { auth } from "../firebase";

const VerifyEmailPrompt = () => {
  const [message, setMessage] = useState("");

  const checkVerification = async () => {
    // Refresh the user data.
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) {
      // Optionally, you can reload the window or update the state in your App.tsx.
      window.location.reload();
    } else {
      setMessage("Email not verified yet. Please check your inbox and click the verification link.");
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "auto", padding: "2rem", textAlign: "center" }}>
      <h2 className="border-b-neutral-800">Please Verify Your Email</h2>
      <p>
        A verification email was sent to your inbox. Please verify your email address and then click the button below.
      </p>
      <button onClick={checkVerification} style={{ padding: "0.5rem 1rem" }}>
        I've Verified My Email
      </button>
      {message && <p style={{ color: "red", marginTop: "1rem" }}>{message}</p>}
    </div>
  );
};

export default VerifyEmailPrompt;
