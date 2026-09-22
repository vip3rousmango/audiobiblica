// Electron main process — starts AudioBiblica backend + nanobot together
import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let mcpServer: ChildProcess | null = null;
let nanobot: ChildProcess | null = null;

function startServices() {
  // Start FastAPI MCP server on localhost:8000 (from repo root / src/backend)
  const backendDir = path.resolve(__dirname, '../..');
  mcpServer = spawn('python3', ['-m', 'uvicorn', 'src.backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendDir,
    stdio: 'pipe',
  });
  mcpServer?.on('error', (e) => console.error('MCP server error:', e));

  // Start nanobot CLI (assumes nanobot repo is at ../nanobot or installed globally via npm/npx)
  // For bundled use: assume nanobot is installed as dependency or available on path
  const nanobotPath = process.env.NANOBOT_PATH || 'docker';
  // If using bundled docker-compose for simplicity in this version:
  // We spawn a lightweight gateway that connects back to MCP server
  nanobot = spawn('docker', ['compose', 'run', '--rm', 'nanobot-cli', 'agent', '-m', 'Hello from AudioBiblica'], {
    cwd: backendDir,
    stdio: 'pipe',
  });
  nanobot?.on('error', (e) => console.error('Nanobot process error:', e));
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('dist/index.html');
  }
}

app.whenReady().then(() => {
  startServices();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  mcpServer?.kill();
  nanobot?.kill();
  if (process.platform !== 'darwin') app.quit();
});
