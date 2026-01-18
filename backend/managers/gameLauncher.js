const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { spawn } = require('child_process');
const { getResolvedAppDir, findClientPath } = require('../core/paths');
const { setupWaylandEnvironment } = require('../utils/platformUtils');
const { saveUsername, saveInstallPath, loadJavaPath, getUuidForUser } = require('../core/config');
const { resolveJavaPath, getJavaExec, getBundledJavaPath, detectSystemJava, JAVA_EXECUTABLE } = require('./javaManager');
const { getInstalledClientVersion, getLatestClientVersion } = require('../services/versionManager');
const { updateGameFiles } = require('./gameManager');

const execAsync = promisify(exec);

async function launchGame(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  const customAppDir = getResolvedAppDir(installPathOverride);
  const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
  const customJreDir = path.join(customAppDir, 'release', 'package', 'jre', 'latest');
  const userDataDir = path.join(customGameDir, 'Client', 'UserData');

  const gameLatest = customGameDir;
  let clientPath = findClientPath(gameLatest);

  if (!clientPath) {
    throw new Error('Game is not installed. Please install the game first.');
  }

  saveUsername(playerName);
  if (installPathOverride) {
    saveInstallPath(installPathOverride);
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
    javaBin = getJavaExec(customJreDir);
    
    if (!getBundledJavaPath(customJreDir)) {
      const fallback = await detectSystemJava();
      if (fallback) {
        javaBin = fallback;
      } else {
        throw new Error('Java runtime not found. Please install the game first or configure Java path.');
      }
    }
  }

  if (process.platform === 'darwin') {
    try {
      const appBundle = path.join(gameLatest, 'Client', 'Hytale.app');
      const serverDir = path.join(gameLatest, 'Server');

      const signPath = async (targetPath, deep = false) => {
        await execAsync(`xattr -cr "${targetPath}"`).catch(() => {});
        const deepFlag = deep ? '--deep ' : '';
        await execAsync(`codesign --force ${deepFlag}--sign - "${targetPath}"`).catch(() => {});
      };

      if (fs.existsSync(appBundle)) {
        await signPath(appBundle, true);
        console.log('Signed macOS app bundle');
      } else {
        await signPath(path.dirname(clientPath), true);
        console.log('Signed macOS client binary');
      }

      if (javaBin && fs.existsSync(javaBin)) {
        let jreRoot = path.dirname(path.dirname(javaBin));
        if (jreRoot.endsWith('Home')) {
          jreRoot = path.dirname(path.dirname(jreRoot));
        }
        await signPath(jreRoot, true);
        await signPath(javaBin, false);
        console.log('Signed Java runtime');
      }

      if (fs.existsSync(serverDir)) {
        await execAsync(`xattr -cr "${serverDir}"`).catch(() => {});
        await execAsync(`find "${serverDir}" -type f -perm +111 -exec codesign --force --sign - {} \\;`).catch(() => {});
        console.log('Signed server binaries');
      }

      if (javaBin && fs.existsSync(javaBin)) {
        const javaWrapperPath = path.join(path.dirname(javaBin), 'java-wrapper');
        const wrapperScript = `#!/bin/bash
# Java wrapper for macOS - adds --disable-sentry to fix Sentry hang issue
REAL_JAVA="${javaBin}"
ARGS=("$@")
for i in "\${!ARGS[@]}"; do
  if [[ "\${ARGS[$i]}" == *"HytaleServer.jar"* ]]; then
    ARGS=("\${ARGS[@]:0:$((i+1))}" "--disable-sentry" "\${ARGS[@]:$((i+1))}")
    break
  fi
done
exec "$REAL_JAVA" "\${ARGS[@]}"
`;
        fs.writeFileSync(javaWrapperPath, wrapperScript, { mode: 0o755 });
        await signPath(javaWrapperPath, false);
        console.log('Created java wrapper with --disable-sentry fix');
        javaBin = javaWrapperPath;
      }
    } catch (signError) {
      console.log('Notice: macOS signing step failed:', signError.message);
      console.log('The game may still launch if Gatekeeper allows it');
    }
  }

  const uuid = getUuidForUser(playerName);
  const args = [
    '--app-dir', gameLatest,
    '--java-exec', javaBin,
    '--auth-mode', 'offline',
    '--uuid', uuid,
    '--name', playerName,
    '--user-dir', userDataDir
  ];

  if (progressCallback) {
    progressCallback('Starting game...', null, null, null, null);
  }
  console.log('Starting game...');
  console.log(`Command: "${clientPath}" ${args.join(' ')}`);

  const env = { ...process.env };
  
  const waylandEnv = setupWaylandEnvironment();
  Object.assign(env, waylandEnv);

  try {
    let spawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: env
    };

    if (process.platform === 'win32') {
      spawnOptions.shell = false; 
      spawnOptions.windowsHide = true; 
    }

    const child = spawn(clientPath, args, spawnOptions);

    console.log(`Game process started with PID: ${child.pid}`);

    let hasExited = false;
    let outputReceived = false;

    child.stdout.on('data', (data) => {
      outputReceived = true;
      console.log(`Game output: ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      outputReceived = true;
      console.error(`Game error: ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      hasExited = true;
      console.error(`Failed to start game process: ${error.message}`);
      if (progressCallback) {
        progressCallback(`Failed to start game: ${error.message}`, -1, null, null, null);
      }
    });

    child.on('exit', (code, signal) => {
      hasExited = true;
      if (code !== null) {
        console.log(`Game process exited with code ${code}`);
        if (code !== 0 && progressCallback) {
          progressCallback(`Game exited with error code ${code}`, -1, null, null, null);
        }
      } else if (signal) {
        console.log(`Game process terminated by signal ${signal}`);
      }
    });

    setTimeout(() => {
      if (!hasExited) {
        console.log('Game appears to be running successfully');
        child.unref();
        if (progressCallback) {
          progressCallback('Game launched successfully', 100, null, null, null);
        }
      } else if (!outputReceived) {
        console.warn('Game process exited immediately with no output - possible issue with game files or dependencies');
      }
    }, 3000);

    return { success: true, installed: true, launched: true, pid: child.pid };
  } catch (spawnError) {
    console.error(`Error spawning game process: ${spawnError.message}`);
    if (progressCallback) {
      progressCallback(`Error launching game: ${spawnError.message}`, -1, null, null, null);
    }
    throw spawnError;
  }
}

async function launchGameWithVersionCheck(playerName = 'Player', progressCallback, javaPathOverride, installPathOverride) {
  try {
    if (progressCallback) {
      progressCallback('Checking for updates...', 0, null, null, null);
    }

    const [installedVersion, latestVersion] = await Promise.all([
      getInstalledClientVersion(),
      getLatestClientVersion()
    ]);

    console.log(`Installed version: ${installedVersion}, Latest version: ${latestVersion}`);

    let needsUpdate = false;
    if (installedVersion && latestVersion && installedVersion !== latestVersion) {
      needsUpdate = true;
      console.log('Version mismatch detected, update required');
    }

    if (needsUpdate) {
      if (progressCallback) {
        progressCallback('Game update required, starting update process...', 10, null, null, null);
      }

      const customAppDir = getResolvedAppDir(installPathOverride);
      const customGameDir = path.join(customAppDir, 'release', 'package', 'game', 'latest');
      const customToolsDir = path.join(customAppDir, 'butler');
      const customCacheDir = path.join(customAppDir, 'cache');

      try {
        await updateGameFiles(latestVersion, progressCallback, customGameDir, customToolsDir, customCacheDir);
        console.log('Game updated successfully, waiting before launch...');
        
        if (progressCallback) {
          progressCallback('Preparing game launch...', 90, null, null, null);
        }
        await new Promise(resolve => setTimeout(resolve, 3000)); 
        
      } catch (updateError) {
        console.error('Update failed:', updateError);
        if (progressCallback) {
          progressCallback(`Update failed: ${updateError.message}`, -1, null, null, null);
        }
        throw updateError;
      }
    }

    if (progressCallback) {
      progressCallback('Launching game...', 80, null, null, null);
    }

    return await launchGame(playerName, progressCallback, javaPathOverride, installPathOverride);
  } catch (error) {
    console.error('Error in version check and launch:', error);
    if (progressCallback) {
      progressCallback(`Error: ${error.message}`, -1, null, null, null);
    }
    throw error;
  }
}

module.exports = {
  launchGame,
  launchGameWithVersionCheck
};
