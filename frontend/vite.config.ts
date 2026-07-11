import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(),
    tailwindcss(),
  ],
  server: {
    // Fixed dev port so parallel sessions/worktrees don't collide. strictPort
    // makes vite fail loudly instead of drifting to another port (which breaks
    // the preview proxy). Override per-checkout via VITE_DEV_PORT in .env.
    port: Number(loadEnv(mode, process.cwd(), '').VITE_DEV_PORT) || 5173,
    strictPort: true,
  },
  define: {
    // Bridge Vercel's build-time VERCEL_ENV (production | preview | development)
    // into the client bundle so dev-only fixtures can detect preview deploys.
    // Empty string locally (where import.meta.env.DEV already applies).
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(process.env.VERCEL_ENV ?? ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // exclude: ["poker-hand-evaluator-wasm"]
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: keeps the big libraries out of the entry chunk
        // and lets them cache independently of app-code changes. Firestore is
        // split from the rest of firebase because only lazy routes use it,
        // while app/auth load eagerly with the shell.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          // "firestore" also catches the firebase/firestore wrapper package —
          // if that lands in the eager "firebase" chunk it re-exports the whole
          // SDK and drags Firestore back onto the critical path.
          if (id.includes("firestore")) return "firebase-firestore";
          if (id.includes("firebase")) return "firebase";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("recharts") || id.includes("victory-vendor") || id.includes("d3-")) return "recharts";
          // Pin the React runtime so Rollup can't colocate it inside another
          // vendor chunk (it grouped react-dom into recharts otherwise). clsx
          // is shared by the app shell and recharts — without a pin it lands
          // in the recharts chunk and the entry preloads all of recharts to
          // get it.
          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("scheduler") ||
            id.includes("clsx")
          ) return "react";
        },
      },
    },
  },
}))
