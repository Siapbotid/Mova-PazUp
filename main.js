const { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');

// MOST AGGRESSIVE GPU FIXES - Apply before any other code
app.disableHardwareAcceleration();

// Disable ALL GPU-related processes and features
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');
app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-compositor-resources');
app.commandLine.appendSwitch('--disable-gpu-process-for-dx12-vulkan-info-collection');
app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor,VizServiceDisplay');
app.commandLine.appendSwitch('--use-gl', 'disabled');
app.commandLine.appendSwitch('--disable-webgl');
app.commandLine.appendSwitch('--disable-webgl2');
app.commandLine.appendSwitch('--disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('--disable-accelerated-jpeg-decoding');
app.commandLine.appendSwitch('--disable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('--disable-accelerated-video-decode');
app.commandLine.appendSwitch('--disable-accelerated-video-encode');
app.commandLine.appendSwitch('--disable-gpu-rasterization');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('--disable-zero-copy');
app.commandLine.appendSwitch('--use-angle', 'disabled');
app.commandLine.appendSwitch('--disable-d3d11');
app.commandLine.appendSwitch('--disable-dxva');
app.commandLine.appendSwitch('--disable-direct-composition');
app.commandLine.appendSwitch('--disable-gpu-driver-bug-workarounds');

// Force CPU-only rendering
process.env['ELECTRON_DISABLE_GPU'] = '1';

// Keep a global reference of the window object
let mainWindow;

// Configuration file path
const configPath = path.join(os.homedir(), '.pazup-config.json');

// Default configuration
const defaultConfig = {
  apiKey: '',
  inputFolder: '',
  outputFolder: '',
  slowMotion: 1,
  cropToFit: false,
  model: 'prob-4',
  frameInterpolation: 'chf-3',
  resolution: '1920x1080',
  removeAudio: false,
  workers: 2
};

function createWindow() {
  // Read version from package.json
  const packageJson = require('./package.json');
  const version = packageJson.version;
  
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `PazUp V${version} - Image & Video Upscale Using Topaz API`,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false,
      offscreen: false,
      hardwareAcceleration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // Load the index.html of the app
  mainWindow.loadFile('index.html');

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    // Set title again to ensure it's applied
    const packageJson = require('./package.json');
    mainWindow.setTitle(`PazUp V${packageJson.version} - Video Upscale Using Topaz API`);
    mainWindow.show();
    mainWindow.focus();
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Enable DevTools shortcut even without menu
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
    if ((input.key && input.key.toLowerCase() === 'f12') || input.code === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Disable the application menu
  Menu.setApplicationMenu(null);
  createWindow();

  // Register F12 to toggle DevTools
  try {
    globalShortcut.register('F12', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools();
      }
    });
  } catch (e) {
    console.warn('Failed to register F12 shortcut:', e.message);
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up shortcuts on quit
app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
});

// IPC handlers
ipcMain.handle('load-config', async () => {
  try {
    if (await fs.pathExists(configPath)) {
      const config = await fs.readJson(configPath);
      return { ...defaultConfig, ...config };
    }
    return defaultConfig;
  } catch (error) {
    console.error('Error loading config:', error);
    return defaultConfig;
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    await fs.writeJson(configPath, config, { spaces: 2 });
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-folder', async (event, title = 'Select Folder') => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  } catch (error) {
    console.error('Error selecting folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-media-files', async (event, folderPath) => {
  try {
    const videoExtensions = ['.mp4', '.mov'];
    const imageExtensions = ['.jpg', '.jpeg', '.png'];
    const files = await fs.readdir(folderPath);
    
    const mediaFiles = [];
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        let fileType = null;
        
        if (videoExtensions.includes(ext)) {
          fileType = 'video';
        } else if (imageExtensions.includes(ext)) {
          fileType = 'image';
        }
        
        if (fileType) {
          mediaFiles.push({
            name: file,
            path: filePath,
            size: stat.size,
            extension: ext,
            type: fileType
          });
        }
      }
    }
    
    return { success: true, files: mediaFiles };
  } catch (error) {
    console.error('Error getting media files:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-machine-id', async () => {
  try {
    if (process.platform === 'win32') {
      try {
        const output = execSync('wmic csproduct get uuid').toString().split('\n');
        const uuidLine = output.find(line => line && line.toLowerCase().includes('-'));
        if (uuidLine) {
          const uuid = uuidLine.replace(/uuid/i, '').trim();
          if (uuid) {
            return uuid;
          }
        }
      } catch (e) {
        console.warn('Failed to read hardware UUID via WMIC:', e.message);
      }
    }

    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.release()}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch (error) {
    console.error('Error generating machine ID:', error);
    return null;
  }
});
