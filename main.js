const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { launchGame, launchGameWithVersionCheck, installGame, saveUsername, loadUsername, saveChatUsername, loadChatUsername, saveChatColor, loadChatColor, saveJavaPath, loadJavaPath, saveInstallPath, loadInstallPath, saveDiscordRPC, loadDiscordRPC, saveLanguage, loadLanguage, isGameInstalled, uninstallGame, repairGame, getHytaleNews, handleFirstLaunchCheck, proposeGameUpdate, markAsLaunched } = require('./backend/launcher');
const UpdateManager = require('./backend/updateManager');
const logger = require('./backend/logger');
const profileManager = require('./backend/managers/profileManager');

logger.interceptConsole();

let mainWindow;
let updateManager;
let discordRPC = null;

// Discord Rich Presence setup
const DISCORD_CLIENT_ID = '1462244937868513373';

function initDiscordRPC() {
  try {
    // Check if Discord RPC is enabled in settings
    const rpcEnabled = loadDiscordRPC();
    if (!rpcEnabled) {
      console.log('Discord RPC disabled in settings');
      return;
    }

    const { Client } = require('discord-rpc');
    discordRPC = new Client({ transport: 'ipc' });

    discordRPC.on('ready', () => {
      console.log('Discord RPC connected');
      setDiscordActivity();
    });

    discordRPC.on('disconnected', () => {
      console.log('Discord RPC disconnected');
    });

    discordRPC.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      console.log('Failed to connect to Discord:', err.message);
    });
  } catch (error) {
    console.log('Discord RPC module not available:', error.message);
  }
}

function setDiscordActivity() {
  if (!discordRPC) return;

  try {
    discordRPC.setActivity({
      details: 'Using HytaleF2P',
      startTimestamp: Date.now(),
      largeImageKey: 'hytale_logo',
      largeImageText: 'Hytale F2P Launcher',
      buttons: [
        {
          label: 'GitHub',
          url: 'https://github.com/amiayweb/Hytale-F2P'
        }
      ]
    });
  } catch (error) {
    console.error('Failed to set Discord activity:', error.message);
  }
}

function toggleDiscordRPC(enabled) {
  console.log('Toggling Discord RPC:', enabled);

  if (enabled && !discordRPC) {
    console.log('Initializing Discord RPC...');
    initDiscordRPC();
  } else if (!enabled && discordRPC) {
    try {
      console.log('Disconnecting Discord RPC...');
      discordRPC.clearActivity();
      discordRPC.destroy();
      discordRPC = null;
      console.log('Discord RPC disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting Discord RPC:', error.message);
      discordRPC = null; // Force null même en cas d'erreur
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    backgroundColor: '#090909',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile('GUI/index.html');

  // Cleanup Discord RPC when window is closed
  mainWindow.on('closed', () => {
    console.log('Main window closed, cleaning up Discord RPC...');
    cleanupDiscordRPC();
  });

  // Initialize Discord Rich Presence
  initDiscordRPC();

  updateManager = new UpdateManager();
  setTimeout(async () => {
    const updateInfo = await updateManager.checkForUpdates();
    if (updateInfo.updateAvailable) {
      mainWindow.webContents.send('show-update-popup', updateInfo);
    }
  }, 3000);

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'j') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault();
    }
    if (input.key === 'F12') {
      event.preventDefault();
    }
    if (input.key === 'F5') {
      event.preventDefault();
    }
  });


  mainWindow.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  mainWindow.webContents.setIgnoreMenuShortcuts(true);
}

app.whenReady().then(async () => {
  console.log('=== HYTALE F2P LAUNCHER STARTED ===');
  console.log('Platform:', process.platform);
  console.log('Architecture:', process.arch);
  console.log('Electron version:', process.versions.electron);
  console.log('Node.js version:', process.versions.node);
  console.log('Log directory:', logger.getLogDirectory());

  try {
    const { loadGpuPreference, detectGpu } = require('./backend/launcher');
    const savedPreference = loadGpuPreference();
    if (savedPreference === 'auto') {
      global.detectedGpu = detectGpu(); // if 'auto' selected = preload GPU detection
      console.log('GPU auto-detection completed on startup:', global.detectedGpu);
    } else {
      console.log('GPU preference is manual, skipping auto-detection');
    }
  } catch (error) {
    console.warn('Failed to preload GPU detection:', error.message);
    global.detectedGpu = { mode: 'integrated', vendor: 'intel' };
  }


  // Initialize Profile Manager (runs migration if needed)
  profileManager.init();

  createWindow();

  setTimeout(async () => {
    let timeoutReached = false;

    const unlockPlayButton = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lock-play-button', false);
      }
    };

    const timeoutId = setTimeout(() => {
      timeoutReached = true;
      console.warn('First launch check timeout reached, unlocking play button');
      unlockPlayButton();
    }, 15000);

    try {
      console.log('Starting first launch check...');

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lock-play-button', true);
      }

      const progressCallback = (message, percent, speed, downloaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('first-launch-progress', { message, percent, speed, downloaded, total });
        }
      };

      const firstLaunchResult = await Promise.race([
        handleFirstLaunchCheck(progressCallback),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('First launch check timeout')), 12000);
        })
      ]);

      clearTimeout(timeoutId);

      if (timeoutReached) {
        console.log('Timeout already reached, skipping result processing');
        return;
      }

      console.log('First launch check result:', firstLaunchResult);

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (firstLaunchResult.needsUpdate && firstLaunchResult.existingGame) {
          console.log('Sending show-first-launch-update event...');

          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-first-launch-update', {
                existingGame: firstLaunchResult.existingGame,
                isFirstLaunch: firstLaunchResult.isFirstLaunch
              });
            }
          }, 1000);

        } else if (firstLaunchResult.isFirstLaunch && !firstLaunchResult.existingGame) {
          console.log('Sending show-first-launch-welcome event...');

          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-first-launch-welcome');
            }
          }, 1000);
        } else {
          unlockPlayButton();
        }
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Error during first launch check:', error);
      if (!timeoutReached) {
        unlockPlayButton();
      }
    }
  }, 3000);
});

function cleanupDiscordRPC() {
  if (discordRPC) {
    try {
      console.log('Cleaning up Discord RPC...');
      discordRPC.clearActivity();
      setTimeout(() => {
        try {
          discordRPC.destroy();
        } catch (error) {
          console.log('Error during final Discord RPC cleanup:', error.message);
        }
      }, 100);
      discordRPC = null;
    } catch (error) {
      console.log('Error cleaning up Discord RPC:', error.message);
      discordRPC = null;
    }
  }
}

app.on('before-quit', () => {
  console.log('=== LAUNCHER BEFORE QUIT ===');
  cleanupDiscordRPC();
});

app.on('window-all-closed', () => {
  console.log('=== LAUNCHER CLOSING ===');

  cleanupDiscordRPC();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('launch-game', async (event, playerName, javaPath, installPath, gpuPreference) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('progress-update', data);
      }
    };

    const result = await launchGameWithVersionCheck(playerName, progressCallback, javaPath, installPath, gpuPreference);

    return result;
  } catch (error) {
    console.error('Launch error:', error);
    const errorMessage = error.message || error.toString();

    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        mainWindow.webContents.send('progress-complete');
      }, 2000);
    }

    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('install-game', async (event, playerName, javaPath, installPath) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('progress-update', data);
      }
    };

    const result = await installGame(playerName, progressCallback, javaPath, installPath);

    return result;
  } catch (error) {
    console.error('Install error:', error);
    const errorMessage = error.message || error.toString();

    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('save-username', (event, username) => {
  saveUsername(username);
  return { success: true };
});

ipcMain.handle('load-username', () => {
  return loadUsername();
});
ipcMain.handle('save-chat-username', async (event, chatUsername) => {
  saveChatUsername(chatUsername);
});

ipcMain.handle('load-chat-username', async () => {
  return loadChatUsername();
});

ipcMain.handle('save-chat-color', (event, color) => {
  saveChatColor(color);
  return { success: true };
});

ipcMain.handle('load-chat-color', () => {
  return loadChatColor();
});

ipcMain.handle('save-java-path', (event, javaPath) => {
  saveJavaPath(javaPath);
  return { success: true };
});

ipcMain.handle('load-java-path', () => {
  return loadJavaPath();
});

ipcMain.handle('save-install-path', (event, installPath) => {
  saveInstallPath(installPath);
  logger.updateInstallPath();
  return { success: true };
});

ipcMain.handle('load-install-path', () => {
  return loadInstallPath();
});

ipcMain.handle('save-discord-rpc', (event, enabled) => {
  saveDiscordRPC(enabled);
  toggleDiscordRPC(enabled);
  return { success: true };
});

ipcMain.handle('load-discord-rpc', () => {
  return loadDiscordRPC();
});

ipcMain.handle('save-language', (event, language) => {
  saveLanguage(language);
  return { success: true };
});

ipcMain.handle('load-language', () => {
  return loadLanguage();
});

ipcMain.handle('select-install-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Installation Folder'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('accept-first-launch-update', async (event, existingGame) => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('first-launch-progress', data);
      }
    };

    const result = await proposeGameUpdate(existingGame, progressCallback);

    return result;
  } catch (error) {
    console.error('First launch update error:', error);
    const errorMessage = error.message || error.toString();
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('mark-as-launched', async () => {
  try {
    markAsLaunched();
    return { success: true };
  } catch (error) {
    console.error('Mark as launched error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('is-game-installed', async () => {
  try {
    return await Promise.race([
      Promise.resolve(isGameInstalled()),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000))
    ]);
  } catch (error) {
    console.error('Error checking game installation:', error);
    return false;
  }
});

ipcMain.handle('uninstall-game', async () => {
  try {
    await uninstallGame();
  } catch (error) {
    console.error('Uninstall error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('repair-game', async () => {
  try {
    const progressCallback = (message, percent, speed, downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const data = {
          message: message || null,
          percent: percent !== null && percent !== undefined ? Math.min(100, Math.max(0, percent)) : null,
          speed: speed !== null && speed !== undefined ? speed : null,
          downloaded: downloaded !== null && downloaded !== undefined ? downloaded : null,
          total: total !== null && total !== undefined ? total : null
        };
        mainWindow.webContents.send('progress-update', data);
      }
    };

    const result = await repairGame(progressCallback);
    return result;
  } catch (error) {
    console.error('Repair error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-hytale-news', async () => {
  try {
    const news = await getHytaleNews();
    return news;
  } catch (error) {
    console.error('News fetch error:', error);
    return [];
  }
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-game-location', async () => {
  try {
    const { getResolvedAppDir } = require('./backend/launcher');
    const gameDir = path.join(getResolvedAppDir(), 'release', 'package', 'game');

    if (fs.existsSync(gameDir)) {
      await shell.openPath(gameDir);
      return { success: true };
    } else {
      throw new Error('Game directory not found');
    }
  } catch (error) {
    console.error('Failed to open game location:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browse-java-path', async () => {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  let dialogOptions;

  if (isWindows) {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      filters: [
        { name: 'Java Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  } else if (isMac) {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      message: 'Select java executable (usually in /Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java)',
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  } else {
    dialogOptions = {
      properties: ['openFile'],
      title: 'Select Java Executable',
      message: 'Select java executable (usually /usr/bin/java or similar)',
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    };
  }

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    if (settings.playerName) saveUsername(settings.playerName);
    if (settings.javaPath !== undefined) saveJavaPath(settings.javaPath);
    if (settings.installPath !== undefined) {
      saveInstallPath(settings.installPath);
      logger.updateInstallPath();
    }
    return { success: true };
  } catch (error) {
    console.error('Save settings error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    return {
      playerName: loadUsername() || 'Player',
      javaPath: loadJavaPath() || '',
      installPath: loadInstallPath() || '',
      customInstall: false
    };
  } catch (error) {
    console.error('Load settings error:', error);
    return {
      playerName: 'Player',
      javaPath: '',
      installPath: '',
      customInstall: false
    };
  }
});

const { getModsPath, loadInstalledMods, downloadMod, uninstallMod, toggleMod, getCurrentUuid, getAllUuidMappings, setUuidForUser, generateNewUuid, deleteUuidForUser, resetCurrentUserUuid } = require('./backend/launcher');
const os = require('os');

ipcMain.handle('get-local-app-data', async () => {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
});

ipcMain.handle('get-user-id', async () => {
  try {
    const { getOrCreatePlayerId } = require('./backend/launcher');
    return await getOrCreatePlayerId();
  } catch (error) {
    console.error('Error getting user ID:', error);
    return null;
  }
});

ipcMain.handle('load-installed-mods', async (event, modsPath) => {
  try {
    return await loadInstalledMods(modsPath);
  } catch (error) {
    console.error('Error loading installed mods:', error);
    return [];
  }
});

ipcMain.handle('openExternalLink', async (event, url) => {
  try {
    console.log('Opening external URL:', url);
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external link:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-mod', async (event, modInfo) => {
  try {
    return await downloadMod(modInfo);
  } catch (error) {
    console.error('Error downloading mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('uninstall-mod', async (event, modId, modsPath) => {
  try {
    return await uninstallMod(modId, modsPath);
  } catch (error) {
    console.error('Error uninstalling mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-mod', async (event, modId, modsPath) => {
  try {
    return await toggleMod(modId, modsPath);
  } catch (error) {
    console.error('Error toggling mod:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-mods-path', async () => {
  try {
    return await getModsPath();
  } catch (error) {
    console.error('Error getting mods path:', error);
    return null;
  }
});

ipcMain.handle('select-mod-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Mod Files',
    filters: [
      { name: 'Mod Files', extensions: ['jar', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths;
  }
  return null;
});

ipcMain.handle('copy-mod-file', async (event, sourcePath, modsPath) => {
  try {
    const fileName = path.basename(sourcePath);
    const destPath = path.join(modsPath, fileName);

    fs.copyFileSync(sourcePath, destPath);

    return { success: true, fileName };
  } catch (error) {
    console.error('Error copying mod file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    return await updateManager.checkForUpdates();
  } catch (error) {
    console.error('Error checking for updates:', error);
    return { updateAvailable: false, error: error.message };
  }
});

ipcMain.handle('open-download-page', async () => {
  try {
    await shell.openExternal(updateManager.getDownloadUrl());

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }, 1000);

    return { success: true };
  } catch (error) {
    console.error('Error opening download page:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-update-info', async () => {
  return updateManager.getUpdateInfo();
});

ipcMain.handle('get-gpu-info', () => {
  try {
    return app.getGPUInfo('complete');
  } catch (error) {
    console.error('Error getting GPU info:', error);
    return {};
  }
});

ipcMain.handle('save-gpu-preference', (event, gpuPreference) => {
  const { saveGpuPreference } = require('./backend/launcher');
  saveGpuPreference(gpuPreference);
  return { success: true };
});

ipcMain.handle('load-gpu-preference', () => {
  const { loadGpuPreference } = require('./backend/launcher');
  return loadGpuPreference();
});

ipcMain.handle('get-detected-gpu', () => {
  if (global.detectedGpu) {
    return global.detectedGpu;
  }
  const { detectGpu } = require('./backend/launcher');
  global.detectedGpu = detectGpu();
  return global.detectedGpu;
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('get-log-directory', () => {
  return logger.getLogDirectory();
});

ipcMain.handle('get-current-uuid', async () => {
  try {
    return getCurrentUuid();
  } catch (error) {
    console.error('Error getting current UUID:', error);
    return null;
  }
});

ipcMain.handle('get-all-uuid-mappings', async () => {
  try {
    const mappings = getAllUuidMappings();
    return Object.entries(mappings).map(([username, uuid]) => ({
      username,
      uuid,
      isCurrent: username === require('./backend/launcher').loadUsername()
    }));
  } catch (error) {
    console.error('Error getting UUID mappings:', error);
    return [];
  }
});

ipcMain.handle('set-uuid-for-user', async (event, username, uuid) => {
  try {
    await setUuidForUser(username, uuid);
    return { success: true };
  } catch (error) {
    console.error('Error setting UUID for user:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-new-uuid', async () => {
  try {
    return generateNewUuid();
  } catch (error) {
    console.error('Error generating new UUID:', error);
    return null;
  }
});

ipcMain.handle('delete-uuid-for-user', async (event, username) => {
  try {
    const result = deleteUuidForUser(username);
    return { success: result };
  } catch (error) {
    console.error('Error deleting UUID for user:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reset-current-user-uuid', async () => {
  try {
    const newUuid = resetCurrentUserUuid();
    return { success: true, uuid: newUuid };
  } catch (error) {
    console.error('Error resetting current user UUID:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recent-logs', async (event, maxLines = 100) => {
  try {
    const logDir = logger.getLogDirectory();
    if (!logDir) return null;

    const files = fs.readdirSync(logDir)
      .filter(file => file.startsWith('launcher-') && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(logDir, file),
        mtime: fs.statSync(path.join(logDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const latestLogFile = files[0].path;
    const content = fs.readFileSync(latestLogFile, 'utf8');
    const lines = content.split('\n');

    let result = lines.slice(-maxLines).join('\n');

    if (lines.length > maxLines) {
      const truncatedMsg = `\n--- ⚠️ LOG TRUNCATED: Showing last ${maxLines} lines of ${lines.length}. Open Logs Folder for full history ---\n\n`;
      return result + truncatedMsg;
    }

    return result;
  } catch (error) {
    console.error('Error reading logs:', error);
    return null;
  }
});



ipcMain.handle('open-logs-folder', async () => {
  try {
    const logDir = logger.getLogDirectory();
    if (logDir && fs.existsSync(logDir)) {
      await shell.openPath(logDir);
      return { success: true };
    }
    return { success: false, error: 'Logs directory not found' };
  } catch (error) {
    console.error('Error opening logs folder:', error);
    return { success: false, error: error.message };
  }
});

// Profile Management IPC
ipcMain.handle('profile-create', async (event, name) => {
  try {
    return profileManager.createProfile(name);
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('profile-list', async () => {
  return profileManager.getProfiles();
});

ipcMain.handle('profile-get-active', async () => {
  return profileManager.getActiveProfile();
});

ipcMain.handle('profile-activate', async (event, id) => {
  try {
    return await profileManager.activateProfile(id);
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('profile-delete', async (event, id) => {
  try {
    return profileManager.deleteProfile(id);
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('profile-update', async (event, id, updates) => {
  try {
    return profileManager.updateProfile(id, updates);
  } catch (error) {
    return { error: error.message };
  }
});
