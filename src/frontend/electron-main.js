// Electron main process — starts AudioBiblica backend and serves frontend
const { app, BrowserWindow } = require('electron');
const { join } = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let mcpServer = null;

function startServices() {
  // Start FastAPI MCP server on localhost:8000
  const backendDir = join(__dirname, '../..');
  mcpServer = spawn('python3', ['-m', 'uvicorn', 'src.backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendDir,
    stdio: 'inherit',
  });
  mcpServer?.on('error', (e) => console.error('MCP server error:', e));
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
    mainWindow.loadFile(join(__dirname, 'dist/index.html'));
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
  if (process.platform !== 'darwin') app.quit();
});