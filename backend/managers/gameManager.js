const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getResolvedAppDir, findClientPath, findUserDataPath, findUserDataRecursive, GAME_DIR, CACHE_DIR, TOOLS_DIR } = require('../core/paths');
const { getOS, getArch } = require('../utils/platformUtils');
const { downloadFile } = require('../utils/fileManager');
const { getLatestClientVersion, getInstalledClientVersion } = require('../services/versionManager');
const { installButler } = require('./butlerManager');
const { downloadAndReplaceHomePageUI, downloadAndReplaceLogo } = require('./uiFileManager');
const { saveUsername, saveInstallPath, loadJavaPath, CONFIG_FILE, loadConfig, loadVersionBranch, saveVersionClient, loadVersionClient } = require('../core/config');
const { resolveJavaPath, detectSystemJava, downloadJRE, getJavaExec, getBundledJavaPath } = require('./javaManager');
const userDataBackup = require('../utils/userDataBackup');

async function downloadPWR(branch = 'release', fileName = '4.pwr', progressCallback, cacheDir = CACHE_DIR) {
  const osName = getOS();
  const arch = getArch();

  if (osName === 'darwin' && arch === 'amd64') {
    throw new Error('Hytale x86_64 Intel Mac Support has not been released yet. Please check back later.');
  }

  const url = `https://game-patches.hytale.com/patches/${osName}/${arch}/${branch}/0/${fileName}`;

  const dest = path.join(cacheDir, `${branch}_${fileName}`);

  // Check if file exists and validate it
  if (fs.existsSync(dest)) {
    console.log('PWR file found in cache:', dest);
    
    // Validate file size (PWR files should be > 1MB)
    const stats = fs.statSync(dest);
    if (stats.size < 1024 * 1024) {
      console.log('Cached PWR file seems corrupted (too small), re-downloading...');
      fs.unlinkSync(dest);
    } else {
      return dest;
    }
  }

  console.log('Fetching PWR patch file:', url);
  await downloadFile(url, dest, progressCallback);
  
  // Validate downloaded file
  const stats = fs.statSync(dest);
  console.log(`PWR file downloaded, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  if (stats.size < 1024 * 1024) {
    fs.unlinkSync(dest);
    throw new Error('Downloaded PWR file is corrupted (file too small)');
  }
  
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
          
          // Check for EOF error (corrupted PWR file)
          if (stderr && stderr.includes('unexpected EOF')) {
            reject(new Error(`Corrupted PWR file detected. Please delete the cache and reinstall: ${pwrFile}`));
          } else {
            reject(new Error(`Patch installation failed: ${error.message}${stderr ? '\n' + stderr : ''}`));
          }
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

async function updateGameFiles(newVersion, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR, cacheDir = CACHE_DIR, branchOverride = null) {
  let tempUpdateDir;
  let backupPath = null;
  const branch = branchOverride || loadVersionBranch();
  const installPath = path.dirname(path.dirname(path.dirname(path.dirname(gameDir))));
  
  // Vérifier si on a version_client et version_branch dans config.json
  const config = loadConfig();
  const hasVersionConfig = !!(config.version_client && config.version_branch);
  const oldBranch = config.version_branch || 'release'; // L'ancienne branche pour le backup
  console.log(`[UpdateGameFiles] hasVersionConfig: ${hasVersionConfig}`);
  console.log(`[UpdateGameFiles] Switching from ${oldBranch} to ${branch}`);
  
  try {
    if (progressCallback) {
      progressCallback('Updating game files...', 0, null, null, null);
    }
    console.log(`Updating game files to version: ${newVersion} (branch: ${branch})`);

    tempUpdateDir = path.join(gameDir, '..', 'temp_update');

    if (fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempUpdateDir, { recursive: true });

    if (progressCallback) {
      progressCallback('Downloading new game version...', 10, null, null, null);
    }

    const pwrFile = await downloadPWR(branch, newVersion, progressCallback, cacheDir);

    if (progressCallback) {
      progressCallback('Extracting new files...', 50, null, null, null);
    }

    await applyPWR(pwrFile, progressCallback, tempUpdateDir, toolsDir);

    if (progressCallback) {
      progressCallback('Backing up user data...', 70, null, null, null);
    }

    // Backup UserData from OLD branch (before switching)
    try {
      console.log(`[UpdateGameFiles] Attempting to backup UserData from old branch: ${oldBranch}`);
      backupPath = await userDataBackup.backupUserData(installPath, oldBranch, hasVersionConfig);
      if (backupPath) {
        console.log(`[UpdateGameFiles] ✓ UserData backed up from ${oldBranch}: ${backupPath}`);
      }
    } catch (backupError) {
      console.warn('[UpdateGameFiles] ✗ UserData backup failed:', backupError.message);
    }

    if (progressCallback) {
      progressCallback('Replacing game files...', 80, null, null, null);
    }

    if (fs.existsSync(gameDir)) {
      console.log('Removing old game files...');
      fs.rmSync(gameDir, { recursive: true, force: true });
    }

    fs.renameSync(tempUpdateDir, gameDir);

    const homeUIResult = await downloadAndReplaceHomePageUI(gameDir, progressCallback);
    console.log('HomePage.ui update result after update:', homeUIResult);

    const logoResult = await downloadAndReplaceLogo(gameDir, progressCallback);
    console.log('Logo@2x.png update result after update:', logoResult);

    // Ensure UserData directory exists
    const userDataDir = path.join(gameDir, 'Client', 'UserData');
    if (!fs.existsSync(userDataDir)) {
      console.log(`[UpdateGameFiles] Creating UserData directory at: ${userDataDir}`);
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    if (progressCallback) {
      progressCallback('Restoring user data...', 90, null, null, null);
    }

    // Restore UserData using new system
    if (backupPath) {
      try {
        console.log(`[UpdateGameFiles] Restoring UserData from ${oldBranch} to ${branch}`);
        console.log(`[UpdateGameFiles] Source backup: ${backupPath}`);
        await userDataBackup.restoreUserData(backupPath, installPath, branch);
        await userDataBackup.cleanupBackup(backupPath);
        console.log(`[UpdateGameFiles] ✓ UserData migrated successfully from ${oldBranch} to ${branch}`);
      } catch (restoreError) {
        console.warn('[UpdateGameFiles] ✗ UserData restore failed:', restoreError.message);
      }
    } else {
      console.log('[UpdateGameFiles] No backup to restore, empty UserData folder created');
    }

    console.log(`Game files updated successfully to version: ${newVersion}`);
    
    // Save the updated version and branch to config
    saveVersionClient(newVersion);
    const { saveVersionBranch } = require('../core/config');
    saveVersionBranch(branch);

    console.log('Waiting for file system sync...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (progressCallback) {
      progressCallback('Game update completed', 100, null, null, null);
    }

    return { success: true, updated: true, version: newVersion };
  } catch (error) {
    console.error('Error updating game files:', error);

    if (backupPath) {
      try {
        await userDataBackup.cleanupBackup(backupPath);
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

function isGameInstalled(branchOverride = null) {
  const branch = branchOverride || loadVersionBranch();
  const appDir = getResolvedAppDir();
  const gameDir = path.join(appDir, branch, 'package', 'game', 'latest');
  const clientPath = findClientPath(gameDir);
  return clientPath !== null;
}

async function installGame(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride, branchOverride = null) {
  const branch = branchOverride || loadVersionBranch();
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customCacheDir = path.join(customAppDir, 'cache');
  const customToolsDir = path.join(customAppDir, 'butler');
  const customGameDir = path.join(customAppDir, branch, 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, branch, 'package', 'jre', 'latest');
  const userDataDir = path.join(customGameDir, 'Client', 'UserData');

  // Vérifier si on a version_client et version_branch dans config.json
  const config = loadConfig();
  const hasVersionConfig = !!(config.version_client && config.version_branch);
  console.log(`[InstallGame] Configuration detected - version_client: ${config.version_client}, version_branch: ${config.version_branch}`);
  console.log(`[InstallGame] hasVersionConfig: ${hasVersionConfig}`);

  // Backup UserData AVANT l'installation si nécessaire
  let backupPath = null;
  if (progressCallback) {
    progressCallback('Checking for existing UserData...', 5, null, null, null);
  }

  try {
    console.log(`[InstallGame] Attempting UserData backup (hasVersionConfig: ${hasVersionConfig})...`);
    backupPath = await userDataBackup.backupUserData(customAppDir, branch, hasVersionConfig);
    if (backupPath) {
      console.log(`[InstallGame] ✓ UserData backed up to: ${backupPath}`);
    }
  } catch (backupError) {
    console.warn('[InstallGame] ✗ UserData backup failed:', backupError.message);
  }

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
  console.log(`Installing game files for branch: ${branch}...`);

  const latestVersion = await getLatestClientVersion(branch);
  const pwrFile = await downloadPWR(branch, latestVersion, progressCallback, customCacheDir);
  await applyPWR(pwrFile, progressCallback, customGameDir, customToolsDir);

  // Save the installed version and branch to config
  saveVersionClient(latestVersion);
  const { saveVersionBranch } = require('../core/config');
  saveVersionBranch(branch);

  const homeUIResult = await downloadAndReplaceHomePageUI(customGameDir, progressCallback);
  console.log('HomePage.ui update result after installation:', homeUIResult);

  const logoResult = await downloadAndReplaceLogo(customGameDir, progressCallback);
  console.log('Logo@2x.png update result after installation:', logoResult);

  // Ensure UserData directory exists
  if (!fs.existsSync(userDataDir)) {
    console.log(`[InstallGame] Creating UserData directory at: ${userDataDir}`);
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Restore UserData from backup if exists
  if (backupPath) {
    if (progressCallback) {
      progressCallback('Restoring UserData...', 95, null, null, null);
    }

    try {
      console.log(`[InstallGame] Restoring UserData from: ${backupPath}`);
      await userDataBackup.restoreUserData(backupPath, customAppDir, branch);
      await userDataBackup.cleanupBackup(backupPath);
      console.log('[InstallGame] ✓ UserData restored successfully');
    } catch (restoreError) {
      console.warn('[InstallGame] ✗ UserData restore failed:', restoreError.message);
    }
  } else {
    console.log('[InstallGame] No backup to restore, empty UserData folder created');
  }

  if (progressCallback) {
    progressCallback('Installation complete', 100, null, null, null);
  }
  console.log('Game installation completed successfully');

  return {
    success: true,
    installed: true
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

function checkExistingGameInstallation(branchOverride = null) {
  try {
    const branch = branchOverride || loadVersionBranch();
    const config = loadConfig();

    if (!config.installPath || !config.installPath.trim()) {
      return null;
    }

    const installPath = config.installPath.trim();
    const gameDir = path.join(installPath, 'HytaleF2P', branch, 'package', 'game', 'latest');

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
      hasUserData: userDataPath && fs.existsSync(userDataPath),
      branch: branch
    };
  } catch (error) {
    console.error('Error checking existing game installation:', error);
    return null;
  }
}

async function repairGame(progressCallback, branchOverride = null) {
  const branch = branchOverride || loadVersionBranch();
  const appDir = getResolvedAppDir();
  const gameDir = path.join(appDir, branch, 'package', 'game', 'latest');
  const installPath = appDir;
  let backupPath = null;

  // Vérifier si on a version_client et version_branch dans config.json
  const config = loadConfig();
  const hasVersionConfig = !!(config.version_client && config.version_branch);
  console.log(`[RepairGame] hasVersionConfig: ${hasVersionConfig}`);

  // Check if game exists
  if (!fs.existsSync(gameDir)) {
    throw new Error('Game directory not found. Cannot repair.');
  }

  if (progressCallback) {
    progressCallback('Backing up user data...', 10, null, null, null);
  }

  // Backup UserData using new system
  try {
    backupPath = await userDataBackup.backupUserData(installPath, branch, hasVersionConfig);
  } catch (backupError) {
    console.warn('UserData backup failed during repair:', backupError.message);
  }

  if (progressCallback) {
    progressCallback('Removing old game files...', 30, null, null, null);
  }

  // Delete Game and Cache Directory
  console.log('Removing corrupted game files...');
  fs.rmSync(gameDir, { recursive: true, force: true });

  const cacheDir = path.join(appDir, 'cache');
  if (fs.existsSync(cacheDir)) {
    console.log('Clearing cache directory...');
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  console.log('Reinstalling game files...');

  // Passing null/undefined for overrides to use defaults/saved configs
  // installGame calls progressCallback internally
  await installGame('Player', progressCallback, null, null, branch);

  // Restore UserData using new system
  if (backupPath) {
    if (progressCallback) {
      progressCallback('Restoring user data...', 90, null, null, null);
    }

    try {
      await userDataBackup.restoreUserData(backupPath, installPath, branch);
      await userDataBackup.cleanupBackup(backupPath);
      console.log('UserData restored successfully after repair');
    } catch (restoreError) {
      console.warn('UserData restore failed after repair:', restoreError.message);
    }
  }

  if (progressCallback) {
    progressCallback('Repair completed successfully!', 100, null, null, null);
  }

  return { success: true, repaired: true };
}

module.exports = {
  downloadPWR,
  applyPWR,
  updateGameFiles,
  isGameInstalled,
  installGame,
  uninstallGame,
  isGameInstalled,
  installGame,
  uninstallGame,
  checkExistingGameInstallation,
  repairGame
};
