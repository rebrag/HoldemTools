// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDrkOzqPzF6aGeXUSpusm-4zX_E1P-6ZH4",
  authDomain: "gto-lite.firebaseapp.com",
  projectId: "gto-lite",
  storageBucket: "gto-lite.firebasestorage.app",
  messagingSenderId: "893831218985",
  appId: "1:893831218985:web:f5850d35e1a4937255d938",
  measurementId: "G-M6TKS917P8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut };
