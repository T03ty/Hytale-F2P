const fs = require('fs');
const path = require('path');
const os = require('os');


// Default auth domain - can be overridden by env var or config
const DEFAULT_AUTH_DOMAIN = 'auth.sanasol.ws';

// Get auth domain from env, config, or default
function getAuthDomain() {
  // First check environment variable
  if (process.env.HYTALE_AUTH_DOMAIN) {
    return process.env.HYTALE_AUTH_DOMAIN;
  }
  // Then check config file
  const config = loadConfig();
  if (config.activeProfileId && config.profiles && config.profiles[config.activeProfileId]) {
    // Allow profile to override auth domain if ever needed
    // but for now stick to global or env
  }
  if (config.authDomain) {
    return config.authDomain;
  }
  // Fall back to default
  return DEFAULT_AUTH_DOMAIN;
}

// Get full auth server URL
// Domain already includes subdomain (auth.sanasol.ws), so use directly
function getAuthServerUrl() {
  const domain = getAuthDomain();
  return `https://${domain}`;
}

// Save auth domain to config
function saveAuthDomain(domain) {
  saveConfig({ authDomain: domain || DEFAULT_AUTH_DOMAIN });
}

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

const CONFIG_FILE = path.join(getAppDir(), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('Notice: could not load config:', err.message);
  }
  return {};
}

function saveConfig(update) {
  try {
    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const config = loadConfig();
    const next = { ...config, ...update };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.log('Notice: could not save config:', err.message);
  }
}

function saveUsername(username) {
  saveConfig({ username: username || 'Player' });
}

function loadUsername() {
  const config = loadConfig();
  return config.username || 'Player';
}

function getUuidForUser(username) {
  const { v4: uuidv4 } = require('uuid');
  const config = loadConfig();
  const userUuids = config.userUuids || {};

  if (userUuids[username]) {
    return userUuids[username];
  }

  const newUuid = uuidv4();
  userUuids[username] = newUuid;
  saveConfig({ userUuids });

  return newUuid;
}

function saveJavaPath(javaPath) {
  const trimmed = (javaPath || '').trim();
  saveConfig({ javaPath: trimmed });
}

function loadJavaPath() {
  const config = loadConfig();

  // Prefer Active Profile's Java Path
  if (config.activeProfileId && config.profiles && config.profiles[config.activeProfileId]) {
    const profile = config.profiles[config.activeProfileId];
    if (profile.javaPath && profile.javaPath.trim().length > 0) {
      return profile.javaPath;
    }
  }

  // Fallback to global setting
  return config.javaPath || '';
}

function saveInstallPath(installPath) {
  const trimmed = (installPath || '').trim();
  saveConfig({ installPath: trimmed });
}

function loadInstallPath() {
  const config = loadConfig();
  return config.installPath || '';
}

function saveDiscordRPC(enabled) {
  saveConfig({ discordRPC: !!enabled });
}

function loadDiscordRPC() {
  const config = loadConfig();
  return config.discordRPC !== undefined ? config.discordRPC : true;
}

function saveLanguage(language) {
  saveConfig({ language: language || 'en' });
}

function loadLanguage() {
  const config = loadConfig();
  return config.language || 'en';
}

function saveCloseLauncherOnStart(enabled) {
  saveConfig({ closeLauncherOnStart: !!enabled });
}

function loadCloseLauncherOnStart() {
  const config = loadConfig();
  return config.closeLauncherOnStart !== undefined ? config.closeLauncherOnStart : false;
}

function saveLauncherHardwareAcceleration(enabled) {
  saveConfig({ launcherHardwareAcceleration: !!enabled });
}

function loadLauncherHardwareAcceleration() {
  const config = loadConfig();
  return config.launcherHardwareAcceleration !== undefined ? config.launcherHardwareAcceleration : true;
}

function saveModsToConfig(mods) {
  try {
    const config = loadConfig();

    // Config migration handles structure, but mod saves must go to the ACTIVE profile.
    // Global installedMods is kept mainly for reference/migration.
    // The profile is the source of truth for enabled mods.


    if (config.activeProfileId && config.profiles && config.profiles[config.activeProfileId]) {
      config.profiles[config.activeProfileId].mods = mods;
    } else {
      // Fallback for legacy or no-profile state
      config.installedMods = mods;
    }

    const configDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Mods saved to config.json');
  } catch (error) {
    console.error('Error saving mods to config:', error);
  }
}

function loadModsFromConfig() {
  try {
    const config = loadConfig();

    // Prefer Active Profile
    if (config.activeProfileId && config.profiles && config.profiles[config.activeProfileId]) {
      return config.profiles[config.activeProfileId].mods || [];
    }

    return config.installedMods || [];
  } catch (error) {
    console.error('Error loading mods from config:', error);
    return [];
  }
}

function isFirstLaunch() {
  const config = loadConfig();

  if ('hasLaunchedBefore' in config) {
    return !config.hasLaunchedBefore;
  }

  const hasUserData = config.installPath || config.username || config.javaPath ||
    config.chatUsername || config.userUuids ||
    Object.keys(config).length > 0;

  if (!hasUserData) {
    return true;
  }

  return true;
}

function markAsLaunched() {
  saveConfig({ hasLaunchedBefore: true, firstLaunchDate: new Date().toISOString() });
}

// UUID Management Functions
function getCurrentUuid() {
  const username = loadUsername();
  return getUuidForUser(username);
}

function getAllUuidMappings() {
  const config = loadConfig();
  return config.userUuids || {};
}

function setUuidForUser(username, uuid) {
  const { v4: uuidv4, validate: validateUuid } = require('uuid');

  // Validate UUID format
  if (!validateUuid(uuid)) {
    throw new Error('Invalid UUID format');
  }

  const config = loadConfig();
  const userUuids = config.userUuids || {};
  userUuids[username] = uuid;
  saveConfig({ userUuids });

  return uuid;
}

function generateNewUuid() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

function deleteUuidForUser(username) {
  const config = loadConfig();
  const userUuids = config.userUuids || {};

  if (userUuids[username]) {
    delete userUuids[username];
    saveConfig({ userUuids });
    return true;
  }

  return false;
}

function resetCurrentUserUuid() {
  const username = loadUsername();
  const { v4: uuidv4 } = require('uuid');
  const newUuid = uuidv4();

  return setUuidForUser(username, newUuid);
}

function saveGpuPreference(gpuPreference) {
  saveConfig({ gpuPreference: gpuPreference || 'auto' });
}

function loadGpuPreference() {
  const config = loadConfig();
  return config.gpuPreference || 'auto';
}

function saveVersionClient(versionClient) {
  saveConfig({ version_client: versionClient });
}

function loadVersionClient() {
  const config = loadConfig();
  return config.version_client !== undefined ? config.version_client : null;
}

function saveVersionBranch(versionBranch) {
  const branch = versionBranch || 'release';
  if (branch !== 'release' && branch !== 'pre-release') {
    console.warn(`Invalid branch "${branch}", defaulting to "release"`);
    saveConfig({ version_branch: 'release' });
  } else {
    saveConfig({ version_branch: branch });
  }
}

function loadVersionBranch() {
  const config = loadConfig();
  return config.version_branch || 'release';
}

module.exports = {
  loadConfig,
  saveConfig,
  saveUsername,
  loadUsername,
  getUuidForUser,
  saveJavaPath,
  loadJavaPath,
  saveInstallPath,
  loadInstallPath,
  saveDiscordRPC,
  loadDiscordRPC,
  saveLanguage,
  loadLanguage,
  saveModsToConfig,
  loadModsFromConfig,
  isFirstLaunch,
  markAsLaunched,
  CONFIG_FILE,
  // Auth server exports
  getAuthServerUrl,
  getAuthDomain,
  saveAuthDomain,
  // UUID Management exports
  getCurrentUuid,
  getAllUuidMappings,
  setUuidForUser,
  generateNewUuid,
  deleteUuidForUser,
  resetCurrentUserUuid,
  // GPU Preference exports
  saveGpuPreference,
  loadGpuPreference,
  // Close Launcher export
  saveCloseLauncherOnStart,
  loadCloseLauncherOnStart,

  // Hardware Acceleration functions
  saveLauncherHardwareAcceleration,
  loadLauncherHardwareAcceleration,

  // Version Management exports
  saveVersionClient,
  loadVersionClient,
  saveVersionBranch,
  loadVersionBranch
};
