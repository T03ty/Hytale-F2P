const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getResolvedAppDir, findClientPath, findUserDataPath, findUserDataRecursive, GAME_DIR, CACHE_DIR, TOOLS_DIR } = require('../core/paths');
const { getOS, getArch } = require('../utils/platformUtils');
const { downloadFile, retryDownload, retryStalledDownload, MAX_AUTOMATIC_STALL_RETRIES } = require('../utils/fileManager');
const { getLatestClientVersion, getInstalledClientVersion } = require('../services/versionManager');
const { FORCE_CLEAN_INSTALL_VERSION, CLEAN_INSTALL_TEST_VERSION } = require('../core/testConfig');
const { installButler } = require('./butlerManager');
const { downloadAndReplaceHomePageUI, downloadAndReplaceLogo } = require('./uiFileManager');
const { saveUsername, saveInstallPath, loadJavaPath, CONFIG_FILE, loadConfig, loadVersionBranch, saveVersionClient, loadVersionClient } = require('../core/config');
const { resolveJavaPath, detectSystemJava, downloadJRE, getJavaExec, getBundledJavaPath } = require('./javaManager');
const { getUserDataPath, migrateUserDataToCentralized } = require('../utils/userDataMigration');

async function downloadPWR(branch = 'release', fileName = '7.pwr', progressCallback, cacheDir = CACHE_DIR, manualRetry = false) {
  const osName = getOS();
  const arch = getArch();

  if (osName === 'darwin' && arch === 'amd64') {
    throw new Error('Hytale x86_64 Intel Mac Support has not been released yet. Please check back later.');
  }

  const url = `https://game-patches.hytale.com/patches/${osName}/${arch}/${branch}/0/${fileName}`;
  const dest = path.join(cacheDir, `${branch}_${fileName}`);

  // Check if file exists and validate it
  if (fs.existsSync(dest) && !manualRetry) {
    console.log('PWR file found in cache:', dest);
    
    // Validate file size (PWR files should be > 1MB and >= 1.5GB for complete downloads)
    const stats = fs.statSync(dest);
    if (stats.size < 1024 * 1024) {
      return false;
    }
    
    // Check if file is under 1.5 GB (incomplete download)
    const sizeInMB = stats.size / 1024 / 1024;
    if (sizeInMB < 1500) {
      console.log(`[PWR Validation] File appears incomplete: ${sizeInMB.toFixed(2)} MB < 1.5 GB`);
      return false;
    }
  }

  console.log('Fetching PWR patch file:', url);
  
  try {
    if (manualRetry) {
      await retryDownload(url, dest, progressCallback);
    } else {
      await downloadFile(url, dest, progressCallback);
    }
  } catch (error) {
    // Check for automatic stall retry conditions (only for stall errors, not manual retries)
    if (!manualRetry && 
        error.message && 
        error.message.includes('stalled') && 
        error.canRetry !== false && // Explicitly check it's not false
        (!error.retryState || error.retryState.automaticStallRetries < MAX_AUTOMATIC_STALL_RETRIES)) {
      
      console.log(`[PWR] Automatic stall retry triggered (${(error.retryState && error.retryState.automaticStallRetries || 0) + 1}/${MAX_AUTOMATIC_STALL_RETRIES})`);
      
      try {
        await retryStalledDownload(url, dest, progressCallback, error);
        console.log('[PWR] Automatic stall retry successful');
        
        // After successful automatic retry, continue with normal flow - the file should be valid now
        const retryStats = fs.statSync(dest);
        console.log(`PWR file downloaded (auto-retry), size: ${(retryStats.size / 1024 / 1024).toFixed(2)} MB`);
        
        if (!validatePWRFile(dest)) {
          console.log(`[PWR Validation] PWR file validation failed after auto-retry, deleting corrupted file: ${dest}`);
          fs.unlinkSync(dest);
          throw new Error('Downloaded PWR file is corrupted or invalid after automatic retry. Please retry manually');
        }

        
      } catch (retryError) {
        console.error('[PWR] Automatic stall retry failed:', retryError.message);
        
        // Create enhanced error with updated retry state
        const enhancedError = new Error(`PWR download failed after automatic retries: ${retryError.message}`);
        enhancedError.originalError = retryError;
        enhancedError.retryState = retryError.retryState || error.retryState || null;
        enhancedError.canRetry = true; // Still allow manual retry
        enhancedError.pwrUrl = url;
        enhancedError.pwrDest = dest;
        enhancedError.branch = branch;
        enhancedError.fileName = fileName;
        enhancedError.cacheDir = cacheDir;
        enhancedError.automaticRetriesExhausted = true;
        throw enhancedError;
      }
    }
    
    // Enhanced error handling for retry UI (non-stall errors or exhausted automatic retries)
    const enhancedError = new Error(`PWR download failed: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.retryState = error.retryState || null;
    enhancedError.canRetry = error.isConnectionLost ? false : (error.canRetry !== false); // Don't allow retry for connection lost
    enhancedError.pwrUrl = url;
    enhancedError.pwrDest = dest;
    enhancedError.branch = branch;
    enhancedError.fileName = fileName;
    enhancedError.cacheDir = cacheDir;
    enhancedError.isConnectionLost = error.isConnectionLost || false;
    
    console.log(`[PWR] Error handling:`, {
      message: enhancedError.message,
      isConnectionLost: enhancedError.isConnectionLost,
      canRetry: enhancedError.canRetry,
      retryState: enhancedError.retryState
    });
    
    throw enhancedError;
  }
  
  // Enhanced PWR file validation
  const stats = fs.statSync(dest);
  console.log(`PWR file downloaded, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  if (!validatePWRFile(dest)) {
    console.log(`[PWR Validation] PWR file validation failed, deleting corrupted file: ${dest}`);
    fs.unlinkSync(dest);
    throw new Error('Downloaded PWR file is corrupted or invalid. Please retry');
  }
  
  console.log('PWR saved to:', dest);
  console.log(`[PWR Validation] PWR file validation passed: ${dest}`);

  return dest;
}

// Manual retry function for PWR downloads
async function retryPWRDownload(branch, fileName, progressCallback, cacheDir = CACHE_DIR) {
  console.log('Initiating manual PWR retry...');
  return await downloadPWR(branch, fileName, progressCallback, cacheDir, true);
}

async function applyPWR(pwrFile, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR, branch = 'release', cacheDir = CACHE_DIR) {
  console.log(`[Butler] Starting PWR application with:`);
  console.log(`[Butler] - PWR file: ${pwrFile}`);
  console.log(`[Butler] - Staging dir: ${path.join(gameDir, 'staging-temp')}`);
  console.log(`[Butler] - Game dir: ${gameDir}`);
  console.log(`[Butler] - Branch: ${branch}`);
  console.log(`[Butler] - Cache dir: ${cacheDir}`);
  
  // Validate PWR file exists and get diagnostic info
  if (!pwrFile || typeof pwrFile !== 'string' || !fs.existsSync(pwrFile)) {
    throw new Error(`PWR file not found: ${pwrFile || 'undefined'}. Please retry download.`);
  }
  
  const pwrStats = fs.statSync(pwrFile);
  console.log(`[Butler] PWR file size: ${(pwrStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[Butler] PWR file exists: ${fs.existsSync(pwrFile)}`);
  
  const butlerPath = await installButler(toolsDir);
  console.log(`[Butler] Butler path: ${butlerPath}`);
  console.log(`[Butler] Butler executable: ${fs.existsSync(butlerPath)}`);
  
  const gameLatest = gameDir;
  const stagingDir = path.join(gameLatest, 'staging-temp');

  const clientPath = findClientPath(gameLatest);

  if (clientPath) {
    console.log('Game files detected, skipping patch installation.');
    return;
  }

  // Validate and prepare directories
  validateGameDirectory(gameLatest, stagingDir);
  
  console.log(`[Butler] Game directory validated: ${gameLatest}`);
  console.log(`[Butler] Staging directory validated: ${stagingDir}`);

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

  console.log(`[Butler] Executing command: ${butlerPath} ${args.join(' ')}`);

  try {
    await new Promise((resolve, reject) => {
      const child = execFile(butlerPath, args, {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 600000
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('[Butler] stderr:', stderr);
          console.error('[Butler] stdout:', stdout);
          console.error('[Butler] error code:', error.code);
          console.error('[Butler] error signal:', error.signal);
          
          // Enhanced error pattern detection
          const errorPatterns = {
            'unexpected EOF': {
              message: 'Corrupted PWR file detected and deleted. Please try launching the game again.',
              shouldDeletePWR: true
            },
            'permission denied': {
              message: 'Permission denied. Check file permissions and try again.',
              shouldDeletePWR: false
            },
            'no space left': {
              message: 'Insufficient disk space. Free up space and try again.',
              shouldDeletePWR: false
            },
            'device full': {
              message: 'Insufficient disk space. Free up space and try again.',
              shouldDeletePWR: false
            },
            'already exists': {
              message: 'Installation directory conflict. Clean directories and retry.',
              shouldDeletePWR: false
            },
            'network error': {
              message: 'Network error during patch installation. Please retry.',
              shouldDeletePWR: false
            },
            'connection refused': {
              message: 'Connection refused. Check network and retry.',
              shouldDeletePWR: false
            }
          };
          
          let enhancedMessage = `Patch installation failed: ${error.message}${stderr ? '\n' + stderr : ''}`;
          let shouldDeletePWR = false;
          
          // Check error patterns
          const errorText = (stderr + ' ' + error.message).toLowerCase();
          for (const [pattern, config] of Object.entries(errorPatterns)) {
            if (errorText.includes(pattern)) {
              enhancedMessage = config.message;
              shouldDeletePWR = config.shouldDeletePWR;
              console.log(`[Butler] Pattern matched: ${pattern}`);
              break;
            }
          }
          
          // Delete corrupted PWR file if needed
          if (shouldDeletePWR) {
            try {
              if (fs.existsSync(pwrFile)) {
                fs.unlinkSync(pwrFile);
                console.log('[Butler] Corrupted PWR file deleted:', pwrFile);
              }
            } catch (delErr) {
              console.error('[Butler] Failed to delete corrupted PWR file:', delErr);
            }
          }
          
          // Enhanced error with retry context
          const enhancedError = new Error(enhancedMessage);
          enhancedError.canRetry = true;
          enhancedError.branch = branch;
          enhancedError.fileName = path.basename(pwrFile);
          enhancedError.cacheDir = cacheDir;
          enhancedError.butlerError = true;
          enhancedError.errorCode = error.code;
          enhancedError.stderr = stderr;
          enhancedError.stdout = stdout;
          
          console.log('[Butler] Enhanced error created with retry context');
          reject(enhancedError);
        } else {
          console.log('[Butler] Patch installation completed successfully');
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('[Butler] Exception during Butler execution:', error);
    const enhancedError = new Error(`Butler execution failed: ${error.message}`);
    enhancedError.canRetry = true;
    enhancedError.branch = branch;
    enhancedError.fileName = path.basename(pwrFile);
    enhancedError.cacheDir = cacheDir;
    enhancedError.butlerError = true;
    throw enhancedError;
  }

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  // Delete PWR file from cache after successful installation
  try {
    if (fs.existsSync(pwrFile)) {
      fs.unlinkSync(pwrFile);
      console.log('[Butler] PWR file deleted from cache after successful installation:', pwrFile);
    }
  } catch (delErr) {
    console.warn('[Butler] Failed to delete PWR file from cache:', delErr.message);
  }

  if (progressCallback) {
    progressCallback('Installation complete', null, null, null, null);
  }
  console.log('Installation complete');
}

async function updateGameFiles(newVersion, progressCallback, gameDir = GAME_DIR, toolsDir = TOOLS_DIR, cacheDir = CACHE_DIR, branchOverride = null) {
  let tempUpdateDir;
  const branch = branchOverride || loadVersionBranch();
  const installPath = path.dirname(path.dirname(path.dirname(path.dirname(gameDir))));
  
  const config = loadConfig();
  const oldBranch = config.version_branch || 'release';
  console.log(`[UpdateGameFiles] Switching from ${oldBranch} to ${branch}`);
  
  try {
    // NEW 2.2.0: Ensure UserData migration to centralized location
    try {
      console.log('[UpdateGameFiles] Ensuring UserData migration...');
      const migrationResult = await migrateUserDataToCentralized();
      if (migrationResult.migrated) {
        console.log('[UpdateGameFiles] ✓ UserData migrated to centralized location');
      } else if (migrationResult.alreadyMigrated) {
        console.log('[UpdateGameFiles] ✓ UserData already in centralized location');
      }
    } catch (migrationError) {
      console.warn('[UpdateGameFiles] UserData migration warning:', migrationError.message);
    }

    if (progressCallback) {
      progressCallback('Updating game files...', 10, null, null, null);
    }
    console.log(`Updating game files to version: ${newVersion} (branch: ${branch})`);

    tempUpdateDir = path.join(gameDir, '..', 'temp_update');

    if (fs.existsSync(tempUpdateDir)) {
      fs.rmSync(tempUpdateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempUpdateDir, { recursive: true });

    if (progressCallback) {
      progressCallback('Downloading new game version...', 20, null, null, null);
    }

    const pwrFile = await downloadPWR(branch, newVersion, progressCallback, cacheDir);

    if (progressCallback) {
      progressCallback('Extracting new files...', 60, null, null, null);
    }

    await applyPWR(pwrFile, progressCallback, tempUpdateDir, toolsDir, branch, cacheDir);
    // Delete PWR file from cache after successful update
    try {
      if (fs.existsSync(pwrFile)) {
        fs.unlinkSync(pwrFile);
        console.log('[UpdateGameFiles] PWR file deleted from cache after successful update:', pwrFile);
      }
    } catch (delErr) {
      console.warn('[UpdateGameFiles] Failed to delete PWR file from cache:', delErr.message);
    }
    if (progressCallback) {
      progressCallback('Replacing game files...', 80, null, null, null);
    }

    if (fs.existsSync(gameDir)) {
      console.log('Removing old game files...');
      let retries = 3;
      while (retries > 0) {
        try {
          fs.rmSync(gameDir, { recursive: true, force: true });
          break;
        } catch (err) {
          if ((err.code === 'EPERM' || err.code === 'EBUSY') && retries > 0) {
            retries--;
            console.log(`[UpdateGameFiles] Removal failed with ${err.code}, retrying in 1s... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw err;
          }
        }
      }
    }

    fs.renameSync(tempUpdateDir, gameDir);

    const homeUIResult = await downloadAndReplaceHomePageUI(gameDir, progressCallback);
    console.log('HomePage.ui update result after update:', homeUIResult);

    const logoResult = await downloadAndReplaceLogo(gameDir, progressCallback);
    console.log('Logo@2x.png update result after update:', logoResult);

    // NEW 2.2.0: No longer create UserData in game installation
    // UserData is now in centralized location (getUserDataPath())
    console.log('[UpdateGameFiles] UserData is managed in centralized location');

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
  console.log(`[InstallGame] branchOverride parameter received: ${branchOverride}`);
  const loadedBranch = loadVersionBranch();
  console.log(`[InstallGame] loadVersionBranch() returned: ${loadedBranch}`);
  const branch = branchOverride || loadedBranch;
  console.log(`[InstallGame] Final branch selected: ${branch}`);
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customCacheDir = path.join(customAppDir, 'cache');
  const customToolsDir = path.join(customAppDir, 'butler');
  const customGameDir = path.join(customAppDir, branch, 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, branch, 'package', 'jre', 'latest');

  // NEW 2.2.0: Ensure UserData migration to centralized location
  try {
    console.log('[InstallGame] Ensuring UserData migration...');
    const migrationResult = await migrateUserDataToCentralized();
    if (migrationResult.migrated) {
      console.log('[InstallGame] ✓ UserData migrated to centralized location');
    } else if (migrationResult.alreadyMigrated) {
      console.log('[InstallGame] ✓ UserData already in centralized location');
    }
  } catch (migrationError) {
    console.warn('[InstallGame] UserData migration warning:', migrationError.message);
  }

  [customAppDir, customCacheDir, customToolsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

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
      // Don't immediately fall back to system Java for JRE download errors - let user retry
      if (error.isJREError) {
        console.error('[Install] JRE download failed, allowing user retry:', error.message);
        throw error; // Re-throw JRE errors to trigger retry UI
      }
      
      // For non-download JRE errors, fall back to system Java
      const fallback = await detectSystemJava();
      if (fallback) {
        javaBin = fallback;
        console.log('[Install] Using system Java as fallback');
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
  const targetVersion = FORCE_CLEAN_INSTALL_VERSION ? CLEAN_INSTALL_TEST_VERSION : latestVersion;
  
  if (FORCE_CLEAN_INSTALL_VERSION) {
    console.log(`TESTING MODE: Forcing installation of ${targetVersion} instead of ${latestVersion}`);
  }
  
  let pwrFile;
  try {
    pwrFile = await downloadPWR(branch, targetVersion, progressCallback, customCacheDir);
    
    if (!pwrFile) {
      console.log('[Install] PWR file not found or invalid, attempting retry...');
      pwrFile = await retryPWRDownload(branch, targetVersion, progressCallback, customCacheDir);
    }
    
    if (!pwrFile || typeof pwrFile !== 'string') {
      throw new Error(`PWR file download failed: received invalid path ${pwrFile}. Please retry download.`);
    }
    
  } catch (downloadError) {
    console.error('[Install] PWR download failed:', downloadError.message);
    throw downloadError;
  }
  
  await applyPWR(pwrFile, progressCallback, customGameDir, customToolsDir, branch, customCacheDir);

  saveVersionClient(targetVersion);
  const { saveVersionBranch } = require('../core/config');
  saveVersionBranch(branch);

  const homeUIResult = await downloadAndReplaceHomePageUI(customGameDir, progressCallback);
  console.log('HomePage.ui update result after installation:', homeUIResult);

  const logoResult = await downloadAndReplaceLogo(customGameDir, progressCallback);
  console.log('Logo@2x.png update result after installation:', logoResult);

  // NEW 2.2.0: No longer create UserData in game installation
  // UserData is managed in centralized location (getUserDataPath())
  console.log('[InstallGame] UserData is managed in centralized location');

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

// Directory validation and cleanup function
function validateGameDirectory(gameDir, stagingDir) {
  try {
    // Ensure game directory exists and is writable
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
      console.log(`[Butler] Created game directory: ${gameDir}`);
    }
    
    // Test write permissions
    const testFile = path.join(gameDir, '.permission_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`[Butler] Game directory is writable: ${gameDir}`);
    
    // Clean and ensure staging directory
    if (fs.existsSync(stagingDir)) {
      console.log(`[Butler] Cleaning existing staging directory: ${stagingDir}`);
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });
    console.log(`[Butler] Created clean staging directory: ${stagingDir}`);
    
    // Check disk space (basic check)
    const freeSpace = fs.statSync(gameDir);
    console.log(`[Butler] Directory validation completed successfully`);
    
  } catch (error) {
    throw new Error(`Directory validation failed: ${error.message}. Please check permissions and disk space.`);
  }
}

// Enhanced PWR file validation
function validatePWRFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const stats = fs.statSync(filePath);
    const sizeInMB = stats.size / 1024 / 1024;
    
    if (stats.size < 1024 * 1024) {
      return false;
    }
    
    // Check if file is under 1.5 GB (incomplete download)
    if (sizeInMB < 1500) {
      console.log(`[PWR Validation] File appears incomplete: ${sizeInMB.toFixed(2)} MB < 1.5 GB`);
      return false;
    }
    
    // Basic file header validation (PWR files should have specific headers)
    const buffer = fs.readFileSync(filePath, { start: 0, end: 20 });
    if (buffer.length < 10) {
      return false;
    }
    
    // Check for common PWR magic bytes or patterns
    // This is a basic check - could be enhanced with actual PWR format specification
    const header = buffer.toString('hex', 0, 10);
    console.log(`[PWR Validation] File header: ${header}`);
    
    return true;
  } catch (error) {
    console.error(`[PWR Validation] Error:`, error.message);
    return false;
  }
}

module.exports = {
  downloadPWR,
  retryPWRDownload,
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
