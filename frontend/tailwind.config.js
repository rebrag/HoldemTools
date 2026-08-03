// tailwind.config.js  (ESM syntax because Vite understands it)

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        logo: ['"Unica One"', "sans-serif"],   // your display font
      },
      colors: {
        accent: "#28e8a9",
      },
      animation: {
        spotlight: "spotlight-sweep 2.2s linear infinite",
      },
    },
  },
  plugins: [
    require("tailwind-scrollbar-hide"),       // ← plugin now included
    // Enter/exit utilities (animate-in, fade-in, slide-in-from-*). The
    // package was already a dependency but never registered, so every
    // `animate-in` in the app was a no-op class.
    require("tailwindcss-animate"),
  ],
};
