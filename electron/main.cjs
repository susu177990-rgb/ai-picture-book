/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://127.0.0.1:3000';
const SERVER_HOST = '127.0.0.1';
const SERVER_BOOT_TIMEOUT_MS = 30_000;

let isQuitting = false;
let mainWindow = null;
let nextServerProcess = null;
let serverUrl = null;

function getBundledServerRoot() {
  return path.join(process.resourcesPath, 'next-app');
}

function getWritableDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function copyMissingFiles(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyMissingFiles(sourcePath, targetPath);
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function ensureSeedData() {
  const bundledDataDir = path.join(getBundledServerRoot(), 'data');
  copyMissingFiles(bundledDataDir, getWritableDataDir());
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, SERVER_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配本地端口')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pingServer(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.on('error', reject);
    request.setTimeout(1_000, () => {
      request.destroy(new Error('timeout'));
    });
  });
}

async function waitForServer(url) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_BOOT_TIMEOUT_MS) {
    try {
      const ready = await pingServer(url);
      if (ready) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await wait(500);
  }

  throw new Error(`桌面端内置服务启动超时：${url}`);
}

function startNextServer(port) {
  const serverRoot = getBundledServerRoot();
  const serverEntry = path.join(serverRoot, 'server.js');

  nextServerProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      APP_DATA_DIR: getWritableDataDir(),
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: SERVER_HOST,
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nextServerProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });

  nextServerProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });

  nextServerProcess.once('exit', (code, signal) => {
    nextServerProcess = null;
    if (!isQuitting) {
      dialog.showErrorBox(
        '内置服务已退出',
        `Next 服务提前结束，code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      );
    }
  });
}

async function ensureServerUrl() {
  if (!app.isPackaged) {
    return DEV_SERVER_URL;
  }

  if (serverUrl) {
    return serverUrl;
  }

  ensureSeedData();

  const port = await getAvailablePort();
  serverUrl = `http://${SERVER_HOST}:${port}`;
  startNextServer(port);
  await waitForServer(serverUrl);
  return serverUrl;
}

async function createMainWindow() {
  const url = await ensureServerUrl();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    title: 'AI儿童绘本生成器',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('应用启动失败', message);
    app.quit();
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await createMainWindow();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox('窗口恢复失败', message);
      }
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (nextServerProcess) {
    nextServerProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
