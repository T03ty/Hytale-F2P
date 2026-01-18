const fs = require('fs');
const path = require('path');
const os = require('os');

function getAppDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'HytaleF2P');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'HytaleF2P');
  } else {
    return path.join(home, '.hytalef2p');
  }
}

const DEFAULT_APP_DIR = getAppDir();

function getResolvedAppDir(customPath) {
  if (customPath && customPath.trim()) {
    return path.join(customPath.trim(), 'HytaleF2P');
  }
  try {
    const configFile = path.join(DEFAULT_APP_DIR, 'config.json');
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (config.installPath && config.installPath.trim()) {
        return path.join(config.installPath.trim(), 'HytaleF2P');
      }
    }
  } catch (err) {
  }
  return DEFAULT_APP_DIR;
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

const APP_DIR = DEFAULT_APP_DIR;
const CACHE_DIR = path.join(APP_DIR, 'cache');
const TOOLS_DIR = path.join(APP_DIR, 'butler');
const GAME_DIR = path.join(APP_DIR, 'release', 'package', 'game', 'latest');
const JRE_DIR = path.join(APP_DIR, 'release', 'package', 'jre', 'latest');
const PLAYER_ID_FILE = path.join(APP_DIR, 'player_id.json');

function getClientCandidates(gameLatest) {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(gameLatest, 'Client', 'Hytale.app', 'Contents', 'MacOS', 'HytaleClient'));
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient'));
  } else {
    candidates.push(path.join(gameLatest, 'Client', 'HytaleClient'));
  }
  return candidates;
}

function findClientPath(gameLatest) {
  const candidates = getClientCandidates(gameLatest);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findUserDataPath(gameLatest) {
  const candidates = [];
  
  candidates.push(path.join(gameLatest, 'Client', 'UserData'));
  
  candidates.push(path.join(gameLatest, 'Client', 'Hytale.app', 'Contents', 'UserData'));
  candidates.push(path.join(gameLatest, 'Hytale.app', 'Contents', 'UserData'));
  candidates.push(path.join(gameLatest, 'UserData'));
  
  candidates.push(path.join(gameLatest, 'Client', 'UserData'));
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  let defaultPath;
  if (process.platform === 'darwin') {
    defaultPath = path.join(gameLatest, 'Client', 'UserData');
  } else {
    defaultPath = path.join(gameLatest, 'Client', 'UserData');
  }
  
  if (!fs.existsSync(defaultPath)) {
    fs.mkdirSync(defaultPath, { recursive: true });
  }
  
  return defaultPath;
}

function findUserDataRecursive(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          const fullPath = path.join(dir, item.name);
          
          if (item.name === 'UserData') {
            return fullPath;
          }
          
          const found = searchDirectory(fullPath);
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  const found = searchDirectory(gameLatest);
  return found;
}

async function getModsPath(customInstallPath = null) {
  try {
    let installPath = customInstallPath;

    if (!installPath) {
      const configFile = path.join(DEFAULT_APP_DIR, 'config.json');
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        installPath = config.installPath || '';
      }
    }

    if (!installPath) {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      installPath = path.join(localAppData, 'HytaleF2P');
    } else {
      installPath = path.join(installPath, 'HytaleF2P');
    }

    const gameLatest = path.join(installPath, 'release', 'package', 'game', 'latest');
    
    const userDataPath = findUserDataPath(gameLatest);
    
    const modsPath = path.join(userDataPath, 'Mods');
    const disabledModsPath = path.join(userDataPath, 'DisabledMods');

    if (!fs.existsSync(modsPath)) {
      fs.mkdirSync(modsPath, { recursive: true });
    }
    if (!fs.existsSync(disabledModsPath)) {
      fs.mkdirSync(disabledModsPath, { recursive: true });
    }

    return modsPath;
  } catch (error) {
    console.error('Error getting mods path:', error);
    throw error;
  }
}

module.exports = {
  getAppDir,
  getResolvedAppDir,
  expandHome,
  APP_DIR,
  CACHE_DIR,
  TOOLS_DIR,
  GAME_DIR,
  JRE_DIR,
  PLAYER_ID_FILE,
  getClientCandidates,
  findClientPath,
  findUserDataPath,
  findUserDataRecursive,
  getModsPath
};
