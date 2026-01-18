const fs = require('fs');
const path = require('path');
const { findClientPath } = require('../core/paths');
const { downloadFile } = require('../utils/fileManager');
const { getLatestClientVersion, getMultiClientVersion } = require('../services/versionManager');

async function downloadMultiClient(gameDir, progressCallback) {
  try {
    if (process.platform !== 'win32') {
      console.log('Multiplayer-client is only available for Windows');
      return { success: false, reason: 'Platform not supported' };
    }

    const clientPath = findClientPath(gameDir);
    if (!clientPath) {
      throw new Error('Game client not found. Install game first.');
    }

    console.log('Downloading Multiplayer from server...');
    if (progressCallback) {
      progressCallback('Downloading Multiplayer...', null, null, null, null);
    }

    const clientUrl = 'http://3.10.208.30:3002/client';
    const tempClientPath = path.join(path.dirname(clientPath), 'HytaleClient_temp.exe');

    await downloadFile(clientUrl, tempClientPath, progressCallback);

    const backupPath = path.join(path.dirname(clientPath), 'HytaleClient_original.exe');
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(clientPath, backupPath);
      console.log('Original client backed up');
    }

    fs.renameSync(tempClientPath, clientPath);
    
    if (progressCallback) {
      progressCallback('Multiplayer installed', 100, null, null, null);
    }
    console.log('Multiplayer installed successfully');

    return { success: true, installed: true };

  } catch (error) {
    console.error('Error installing Multiplayer:', error);
    throw new Error(`Failed to install Multiplayer: ${error.message}`);
  }
}

async function checkAndInstallMultiClient(gameDir, progressCallback) {
  try {
    if (process.platform !== 'win32') {
      console.log('Multiplayer check skipped (Windows only)');
      return { success: true, skipped: true, reason: 'Windows only' };
    }

    console.log('Checking for Multiplayer availability...');
    
    const [clientVersion, multiVersion] = await Promise.all([
      getLatestClientVersion(),
      getMultiClientVersion()
    ]);

    if (!multiVersion) {
      console.log('Multiplayer not available');
      return { success: true, skipped: true, reason: 'Multiplayer not available' };
    }

    if (clientVersion === multiVersion) {
      console.log(`Versions match (${clientVersion}), installing Multiplayer...`);
      return await downloadMultiClient(gameDir, progressCallback);
    } else {
      console.log(`Version mismatch: client=${clientVersion}, multi=${multiVersion}`);
      return { success: true, skipped: true, reason: 'Version mismatch' };
    }

  } catch (error) {
    console.error('Error checking Multiplayer:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  downloadMultiClient,
  checkAndInstallMultiClient
};
