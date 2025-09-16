// src/components/VerifyEmailPrompt.tsx
import { useState } from "react";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";

const VerifyEmailPrompt = () => {
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const checkVerification = async () => {
    await auth.currentUser?.reload();
    if (auth.currentUser?.emailVerified) {
      window.location.reload();
    } else {
      setMessage("Email not verified yet. Please check your inbox and click the verification link.");
    }
  };

  const handleReturnHome = async () => {
    await signOut(auth);
    navigate("/");
  };

  return (
    <div className="h-auto flex flex-col">
      <div className="flex items-center justify-center p-4 flex-grow">
        <div className="w-full max-w-md p-8 bg-white shadow-md rounded text-center">
          <h2 className="text-2xl font-bold mb-4 border-b pb-2 border-gray-200">
            Please Verify Your Email
          </h2>
          <p className="mb-6 text-gray-700">
            A verification email was sent to your inbox. Please verify your email address and then click the button below.
          </p>
          <button
            onClick={checkVerification}
            className="cursor-pointer px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition duration-200"
          >
            I've Verified My Email
          </button>
          {message && <p className="mt-4 text-red-500 text-sm">{message}</p>}
          <button
            onClick={handleReturnHome}
            className="mt-6 cursor-pointer px-6 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition duration-200"
          >
            Return Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPrompt;
