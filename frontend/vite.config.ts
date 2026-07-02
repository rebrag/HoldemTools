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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // exclude: ["poker-hand-evaluator-wasm"]
  }
}))
