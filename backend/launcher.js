// Main launcher module - orchestrates all launcher functionality
// This file serves as the main entry point and re-exports all necessary functions

// Core modules
const {
  saveUsername,
  loadUsername,
  saveChatUsername,
  loadChatUsername,
  saveJavaPath,
  loadJavaPath,
  saveInstallPath,
  loadInstallPath,
  saveModsToConfig,
  loadModsFromConfig,
  getUuidForUser,
  isFirstLaunch,
  markAsLaunched,
  CONFIG_FILE
} = require('./core/config');

const { getResolvedAppDir, getModsPath } = require('./core/paths');

// Managers
const {
  isGameInstalled,
  installGame,
  uninstallGame,
  updateGameFiles,
  checkExistingGameInstallation
} = require('./managers/gameManager');

const {
  launchGame,
  launchGameWithVersionCheck
} = require('./managers/gameLauncher');

const { getJavaDetection } = require('./managers/javaManager');

const { checkAndInstallMultiClient } = require('./managers/multiClientManager');

const {
  downloadAndReplaceHomePageUI,
  findHomePageUIPath,
  downloadAndReplaceLogo,
  findLogoPath
} = require('./managers/uiFileManager');

const {
  loadInstalledMods,
  downloadMod,
  uninstallMod,
  toggleMod
} = require('./managers/modManager');

// Services
const {
  getInstalledClientVersion,
  getLatestClientVersion
} = require('./services/versionManager');

const { getHytaleNews } = require('./services/newsManager');

const { getOrCreatePlayerId } = require('./services/playerManager');

const {
  proposeGameUpdate,
  handleFirstLaunchCheck
} = require('./services/firstLaunch');

// Re-export all functions to maintain backward compatibility
module.exports = {
  // Game launch functions
  launchGame,
  launchGameWithVersionCheck,
  
  // Game installation functions
  installGame,
  isGameInstalled,
  uninstallGame,
  updateGameFiles,
  
  // User configuration functions
  saveUsername,
  loadUsername,
  saveChatUsername,
  loadChatUsername,
  getUuidForUser,
  
  // Java configuration functions
  saveJavaPath,
  loadJavaPath,
  getJavaDetection,
  
  // Installation path functions
  saveInstallPath,
  loadInstallPath,
  
  // Version functions
  getInstalledClientVersion,
  getLatestClientVersion,
  
  // News functions
  getHytaleNews,
  
  // Player ID functions
  getOrCreatePlayerId,
  
  // Multi-client functions
  checkAndInstallMultiClient,
  
  // Mod management functions
  getModsPath,
  loadInstalledMods,
  downloadMod,
  uninstallMod,
  toggleMod,
  saveModsToConfig,
  loadModsFromConfig,
  
  // UI file management functions
  downloadAndReplaceHomePageUI,
  findHomePageUIPath,
  downloadAndReplaceLogo,
  findLogoPath,
  
  // First launch functions
  isFirstLaunch,
  markAsLaunched,
  checkExistingGameInstallation,
  proposeGameUpdate,
  handleFirstLaunchCheck,
  
  // Path functions
  getResolvedAppDir
};
