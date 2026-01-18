const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getResolvedAppDir, findClientPath, findUserDataPath, findUserDataRecursive, GAME_DIR, CACHE_DIR, TOOLS_DIR } = require('../core/paths');
const { getOS, getArch } = require('../utils/platformUtils');
const { downloadFile } = require('../utils/fileManager');
const { getLatestClientVersion, getInstalledClientVersion } = require('../services/versionManager');
const { installButler } = require('./butlerManager');
const { checkAndInstallMultiClient } = require('./multiClientManager');
const { downloadAndReplaceHomePageUI, downloadAndReplaceLogo } = require('./uiFileManager');
const { saveUsername, saveInstallPath, loadJavaPath, CONFIG_FILE, loadConfig } = require('../core/config');
const { resolveJavaPath, detectSystemJava, downloadJRE, getJavaExec, getBundledJavaPath } = require('./javaManager');

async function downloadPWR(version = 'release', fileName = '4.pwr', progressCallback, cacheDir = CACHE_DIR) {
  const osName = getOS();
  const arch = getArch();
  const url = `https://game-patches.hytale.com/patches/${osName}/${arch}/${version}/0/${fileName}`;
  
  const dest = path.join(cacheDir, fileName);

  if (fs.existsSync(dest)) {
    console.log('PWR file found in cache:', dest);
    return dest;
  }

  console.log('Fetching PWR patch file:', url);
  await downloadFile(url, dest, progressCallback);
  console.log('PWR saved to:', dest);
  
  return dest;
}

async function applyPWR(pwrFile, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR) {
  const butlerPath = await installButler(toolsDir);
  const gameLatest = gameDir;
  const stagingDir = path.join(gameLatest, 'staging-temp');
  
  const clientPath = findClientPath(gameLatest);
  
  if (clientPath) {
    console.log('Game files detected, skipping patch installation.');
    return;
  }

  if (!fs.existsSync(gameLatest)) {
    fs.mkdirSync(gameLatest, { recursive: true });
  }
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  if (progressCallback) {
    progressCallback('Installing game patch...', null, null, null, null);
  }

  console.log('Installing game patch...');
  
  if (!fs.existsSync(butlerPath)) {
    throw new Error(`Butler tool not found at: ${butlerPath}`);
  }
  
  if (!fs.existsSync(pwrFile)) {
    throw new Error(`PWR file not found at: ${pwrFile}`);
  }

  const args = [
    'apply',
    '--staging-dir',
    stagingDir,
    pwrFile,
    gameLatest
  ];
  
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(butlerPath, args, {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 600000
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Butler stderr:', stderr);
          console.error('Butler stdout:', stdout);
          reject(new Error(`Patch installation failed: ${error.message}${stderr ? '\n' + stderr : ''}`));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    throw error;
  }

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  if (progressCallback) {
    progressCallback('Installation complete', null, null, null, null);
  }
  console.log('Installation complete');
}

async function updateGameFiles(newVersion, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR, cacheDir = CACHE_DIR) {
  let tempUpdateDir;
  try {
    if (progressCallback) {
      progressCallback('Updating game files...', 0, null, null, null);
    }
    console.log(`Updating game files to version: ${newVersion}`);

    tempUpdateDir = path.join(gameDir, '..', 'temp_update');
    
    if (fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempUpdateDir, { recursive: true });

    if (progressCallback) {
      progressCallback('Downloading new game version...', 10, null, null, null);
    }
    
    const pwrFile = await downloadPWR('release', newVersion, progressCallback, cacheDir);
    
    if (progressCallback) {
      progressCallback('Extracting new files...', 50, null, null, null);
    }
    
    await applyPWR(pwrFile, progressCallback, tempUpdateDir, toolsDir);
    
    if (progressCallback) {
      progressCallback('Replacing game files...', 80, null, null, null);
    }
    
    let userDataBackup = null;
    const userDataPath = findUserDataRecursive(gameDir);
    
    if (userDataPath && fs.existsSync(userDataPath)) {
      userDataBackup = path.join(gameDir, '..', 'UserData_backup_' + Date.now());
      console.log(`Backing up UserData from ${userDataPath} to: ${userDataBackup}`);
      
      function copyRecursive(src, dest) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const file of files) {
            copyRecursive(path.join(src, file), path.join(dest, file));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      }
      
      copyRecursive(userDataPath, userDataBackup);
    } else {
      console.log('No UserData folder found in game directory');
    }
    
    if (fs.existsSync(gameDir)) {
      console.log('Removing old game files...');
      fs.rmSync(gameDir, { recursive: true, force: true });
    }
    
    fs.renameSync(tempUpdateDir, gameDir);
    
    const multiResult = await checkAndInstallMultiClient(gameDir, progressCallback);
    console.log('Multiplayer-client check result after update:', multiResult);
    
    const homeUIResult = await downloadAndReplaceHomePageUI(gameDir, progressCallback);
    console.log('HomePage.ui update result after update:', homeUIResult);
    
    const logoResult = await downloadAndReplaceLogo(gameDir, progressCallback);
    console.log('Logo@2x.png update result after update:', logoResult);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      const newUserDataPath = findUserDataPath(gameDir);
      const userDataParent = path.dirname(newUserDataPath);
      
      if (!fs.existsSync(userDataParent)) {
        fs.mkdirSync(userDataParent, { recursive: true });
      }
      
      console.log(`Restoring UserData to: ${newUserDataPath}`);
      
      function copyRecursive(src, dest) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const file of files) {
            copyRecursive(path.join(src, file), path.join(dest, file));
          }
        } else {
          fs.copyFileSync(src, dest);
        }
      }
      
      copyRecursive(userDataBackup, newUserDataPath);
    }
    
    console.log(`Game files updated successfully to version: ${newVersion}`);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      try {
        fs.rmSync(userDataBackup, { recursive: true, force: true });
        console.log('UserData backup cleaned up');
      } catch (cleanupError) {
        console.warn('Could not clean up UserData backup:', cleanupError.message);
      }
    }
    
    console.log('Waiting for file system sync...');
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    
    if (progressCallback) {
      progressCallback('Game update completed', 100, null, null, null);
    }
    
    return { success: true, updated: true, version: newVersion };
  } catch (error) {
    console.error('Error updating game files:', error);
    
    if (userDataBackup && fs.existsSync(userDataBackup)) {
      try {
        fs.rmSync(userDataBackup, { recursive: true, force: true });
        console.log('UserData backup cleaned up after error');
      } catch (cleanupError) {
        console.warn('Could not clean up UserData backup:', cleanupError.message);
      }
    }
    
    if (tempUpdateDir && fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    
    throw new Error(`Failed to update game files: ${error.message}`);
  }
}

function isGameInstalled() {
  const appDir = getResolvedAppDir();
  const gameDir = path.join(appDir, 'release', 'package', 'game', 'latest');
  const clientPath = findClientPath(gameDir);
  return clientPath !== null;
}

async function installGame(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customCacheDir = path.join(customAppDir, 'cache');
  const customToolsDir = path.join(customAppDir, 'butler');
  const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, 'release', 'package', 'jre', 'latest');
  const userDataDir = path.join(customGameDir, 'Client', 'UserData');

  [customAppDir, customCacheDir, customToolsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  saveUsername(playerName);
  if (installPathOverride) {
    saveInstallPath(installPathOverride);
  }

  const gameLatest = customGameDir;
  let clientPath = findClientPath(gameLatest);

  if (clientPath) {
    if (progressCallback) {
      progressCallback('Game already installed', 100, null, null, null);
    }
    console.log('Game is already installed');
    return { success: true, alreadyInstalled: true };
  }

  const configuredJava = (javaPathOverride !== undefined && javaPathOverride !== null
    ? javaPathOverride
    : loadJavaPath() || '').trim();
  let javaBin = null;

  if (configuredJava) {
    javaBin = await resolveJavaPath(configuredJava);
    if (!javaBin) {
      throw new Error(`Configured Java path not found: ${configuredJava}`);
    }
  } else {
    try {
      await downloadJRE(progressCallback, customCacheDir, customJreDir);
    } catch (error) {
      const fallback = await detectSystemJava();
      if (fallback) {
        javaBin = fallback;
      } else {
        throw error;
      }
    }

    if (!javaBin) {
      javaBin = getJavaExec(customJreDir);
    }
  }

  if (progressCallback) {
    progressCallback('Fetching game files...', null, null, null, null);
  }
  console.log('Installing game files...');
  
  const latestVersion = await getLatestClientVersion();
  const pwrFile = await downloadPWR('release', latestVersion, progressCallback, customCacheDir);
  await applyPWR(pwrFile, progressCallback, customGameDir, customToolsDir);
  
  const multiResult = await checkAndInstallMultiClient(customGameDir, progressCallback);
  console.log('Multiplayer check result:', multiResult);
  
  const homeUIResult = await downloadAndReplaceHomePageUI(customGameDir, progressCallback);
  console.log('HomePage.ui update result after installation:', homeUIResult);
  
  const logoResult = await downloadAndReplaceLogo(customGameDir, progressCallback);
  console.log('Logo@2x.png update result after installation:', logoResult);
  
  if (progressCallback) {
    progressCallback('Installation complete', 100, null, null, null);
  }
  console.log('Game installation completed successfully');
  
  return { 
    success: true, 
    installed: true, 
    multiClient: multiResult 
  };
}

async function uninstallGame() {
  const appDir = getResolvedAppDir();
  
  if (!fs.existsSync(appDir)) {
    throw new Error('Game is not installed');
  }

  try {
    fs.rmSync(appDir, { recursive: true, force: true });
    console.log('Game uninstalled successfully - removed entire HytaleF2P folder');
    
    if (fs.existsSync(CONFIG_FILE)) {
      const config = loadConfig();
      delete config.installPath;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    }
  } catch (error) {
    throw new Error(`Failed to uninstall game: ${error.message}`);
  }
}

function checkExistingGameInstallation() {
  try {
    const config = loadConfig();
    
    if (!config.installPath || !config.installPath.trim()) {
      return null;
    }
    
    const installPath = config.installPath.trim();
    const gameDir = path.join(installPath, 'HytaleF2P', 'release', 'package', 'game', 'latest');
    
    if (!fs.existsSync(gameDir)) {
      return null;
    }
    
    const clientPath = findClientPath(gameDir);
    if (!clientPath) {
      return null;
    }
    
    const userDataPath = findUserDataRecursive(gameDir);
    
    return {
      gameDir: gameDir,
      clientPath: clientPath,
      userDataPath: userDataPath,
      installPath: installPath,
      hasUserData: userDataPath && fs.existsSync(userDataPath)
    };
  } catch (error) {
    console.error('Error checking existing game installation:', error);
    return null;
  }
}

module.exports = {
  downloadPWR,
  applyPWR,
  updateGameFiles,
  isGameInstalled,
  installGame,
  uninstallGame,
  checkExistingGameInstallation
};
