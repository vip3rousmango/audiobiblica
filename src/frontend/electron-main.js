// Electron main process — starts AudioBiblica backend + nanobot together
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow = null;
let mcpServer = null;
let nanobot = null;

function startServices() {
  // Start FastAPI MCP server on localhost:8000
  const backendDir = path.resolve(__dirname, '../..');
  mcpServer = spawn('python3', ['-m', 'uvicorn', 'src.backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendDir,
    stdio: 'inherit',
  });
  mcpServer?.on('error', (e) => console.error('MCP server error:', e));

  // Start nanobot CLI - using docker compose run for now (later can be bundled)
  // For simplicity in this version, we assume Docker is available and nanobot repo is cloned at ../nanobot
  // In production, we'd bundle nanobot binary or use npm package
  console.log('Nanobot integration: skipping direct spawn for now (requires Docker setup)');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  startServices();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  mcpServer?.kill();
  nanobot?.kill();
  if (process.platform !== 'darwin') app.quit();
});