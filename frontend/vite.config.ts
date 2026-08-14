import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from "path"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import dotenv from "dotenv"

/**
 * Dev-only auto-sign-in as the developer's real account.
 *
 * Serves the E2E_EMAIL / E2E_PASSWORD pair from ~/.holdemtools/env/e2e.env
 * (the same outside-the-repo file the authed Playwright lane uses) at
 * /__dev/real-auth-creds, and src/lib/devRealAuth.ts fetches it on page load
 * to sign the app in when no session exists. This is what lets a dev server -
 * including one driven by an agent's browser - see the account's real hand
 * histories and solutions without the password ever entering the repo, the
 * bundle, or a chat.
 *
 * Scope guards, in order: configureServer only exists on the DEV server (a
 * production build has no trace of this); the endpoint answers loopback
 * requests only (a --host LAN exposure for phone testing does not leak it);
 * the file is re-read per request so edits apply live; values are never
 * logged. Opt out with DEV_REAL_AUTH=false; inert when the file is absent or
 * the emulators are on.
 */
function devRealAuth(mode: string): Plugin {
  return {
    name: "dev-real-auth",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      const disabled =
        (process.env.DEV_REAL_AUTH ?? env.DEV_REAL_AUTH) === "false" ||
        (process.env.USE_FIREBASE_EMULATOR ?? env.USE_FIREBASE_EMULATOR) === "true"
      if (disabled) return
      server.middlewares.use("/__dev/real-auth-creds", (req, res) => {
        const notFound = () => { res.statusCode = 404; res.end() }
        const addr = req.socket.remoteAddress
        if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") return notFound()
        const dir = process.env.HOLDEMTOOLS_ENV_DIR || path.join(homedir(), ".holdemtools", "env")
        const file = path.join(dir, "e2e.env")
        if (!existsSync(file)) return notFound()
        const creds = dotenv.parse(readFileSync(file, "utf8"))
        if (!creds.E2E_EMAIL || !creds.E2E_PASSWORD) return notFound()
        res.setHeader("Content-Type", "application/json")
        res.setHeader("Cache-Control", "no-store")
        res.end(JSON.stringify({ email: creds.E2E_EMAIL, password: creds.E2E_PASSWORD }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(),
    tailwindcss(),
    devRealAuth(mode),
  ],
  server: {
    // Fixed dev port so parallel sessions/worktrees don't collide. strictPort
    // makes vite fail loudly instead of drifting to another port (which breaks
    // the preview proxy). Override per-checkout via VITE_DEV_PORT in .env.
    port: Number(loadEnv(mode, process.cwd(), '').VITE_DEV_PORT) || 5173,
    strictPort: true,
    // Opt-in same-origin proxy to a locally running API: set
    // VITE_DEV_API_PROXY=http://localhost:5192 and VITE_API_BASE_URL= (empty)
    // in .env so /api requests stay on the dev-server origin.
    proxy: loadEnv(mode, process.cwd(), '').VITE_DEV_API_PROXY
      ? {
          "/api": {
            target: loadEnv(mode, process.cwd(), '').VITE_DEV_API_PROXY,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  define: {
    // Bridge Vercel's build-time VERCEL_ENV (production | preview | development)
    // into the client bundle so dev-only fixtures can detect preview deploys.
    // Empty string locally (where import.meta.env.DEV already applies).
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(process.env.VERCEL_ENV ?? ""),
    // Bridge USE_FIREBASE_EMULATOR into the client bundle. It has no VITE_
    // prefix (the same flag drives the backend and the emulator scripts), so
    // Vite would not expose it on its own. Shell env wins (cloud sessions);
    // .env is honored too so local emulator runs don't need an exported var.
    // Empty string = off, which is what every Vercel build sees.
    "import.meta.env.VITE_USE_FIREBASE_EMULATOR": JSON.stringify(
      process.env.USE_FIREBASE_EMULATOR
        ?? loadEnv(mode, process.cwd(), '').USE_FIREBASE_EMULATOR
        ?? ""
    ),
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
