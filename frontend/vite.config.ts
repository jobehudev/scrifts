import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const DIR = import.meta.dirname
const ROOT = path.resolve(DIR, '..')
const BACKEND_PORT = Number(process.env.SCRIFTS_API_PORT || process.env.FORGE_API_PORT) || 8765  // a second copy for testing: SCRIFTS_API_PORT=8811 and vite --port 5199

function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
  })
}

function forgeBackend(): Plugin {
  let proc: ChildProcess | null = null
  const stop = () => {
    if (!proc || proc.killed) return
    const pid = proc.pid
    proc = null
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try { process.kill(pid!, 'SIGTERM') } catch { /* already gone */ }
    }
  }
  return {
    name: 'forge-backend',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        if (await isPortOpen(BACKEND_PORT)) return
        const venvPy = process.platform === 'win32'
          ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
          : path.join(ROOT, '.venv', 'bin', 'python')
        const py = fs.existsSync(venvPy) ? venvPy : 'python'
        proc = spawn(py, ['-m', 'uvicorn', 'server:app', '--app-dir', path.join(ROOT, 'backend'), '--port', String(BACKEND_PORT)], {
          cwd: ROOT,
          stdio: 'inherit',
        })
        proc.on('exit', () => { proc = null })
      })
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      process.once('SIGINT', () => { stop(); process.exit(0) })
      process.once('SIGTERM', () => { stop(); process.exit(0) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), forgeBackend()],
  resolve: { alias: { '@': path.resolve(DIR, './src') } },
  server: { port: 5173, proxy: { '/api': `http://127.0.0.1:${BACKEND_PORT}` } },
})
