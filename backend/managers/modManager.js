const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { getModsPath } = require('../core/paths');
const { saveModsToConfig, loadModsFromConfig } = require('../core/config');

function generateModId(filename) {
  return crypto.createHash('md5').update(filename).digest('hex').substring(0, 8);
}

function extractModName(filename) {
  let name = path.parse(filename).name;
  
  name = name.replace(/-v?\d+\.[\d\.]+.*$/i, '');
  name = name.replace(/-\d+\.[\d\.]+.*$/i, '');
  
  name = name.replace(/[-_]/g, ' ');
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  
  return name || 'Unknown Mod';
}

function extractVersion(filename) {
  const versionMatch = filename.match(/v?(\d+\.[\d\.]+)/);
  return versionMatch ? versionMatch[1] : null;
}

async function loadInstalledMods(modsPath) {
  try {
    const configMods = loadModsFromConfig();
    const modsMap = new Map();
    
    configMods.forEach(mod => {
      modsMap.set(mod.fileName, mod);
    });
    
    if (fs.existsSync(modsPath)) {
      const files = fs.readdirSync(modsPath);
      
      for (const file of files) {
        const filePath = path.join(modsPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && (file.endsWith('.jar') || file.endsWith('.zip'))) {
          const configMod = modsMap.get(file);
          
          const modInfo = {
            id: configMod?.id || generateModId(file),
            name: configMod?.name || extractModName(file),
            version: configMod?.version || extractVersion(file) || '1.0.0',
            description: configMod?.description || 'Installed mod',
            author: configMod?.author || 'Unknown',
            enabled: true,
            filePath: filePath,
            fileName: file,
            fileSize: configMod?.fileSize || stats.size,
            dateInstalled: configMod?.dateInstalled || stats.birthtime || stats.mtime,
            curseForgeId: configMod?.curseForgeId,
            curseForgeFileId: configMod?.curseForgeFileId
          };
          
          modsMap.set(file, modInfo);
        }
      }
    }
    
    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    if (fs.existsSync(disabledModsPath)) {
      const files = fs.readdirSync(disabledModsPath);
      
      for (const file of files) {
        const filePath = path.join(disabledModsPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isFile() && (file.endsWith('.jar') || file.endsWith('.zip'))) {
          const configMod = modsMap.get(file);
          
          const modInfo = {
            id: configMod?.id || generateModId(file),
            name: configMod?.name || extractModName(file),
            version: configMod?.version || extractVersion(file) || '1.0.0',
            description: configMod?.description || 'Disabled mod',
            author: configMod?.author || 'Unknown',
            enabled: false,
            filePath: filePath,
            fileName: file,
            fileSize: configMod?.fileSize || stats.size,
            dateInstalled: configMod?.dateInstalled || stats.birthtime || stats.mtime,
            curseForgeId: configMod?.curseForgeId,
            curseForgeFileId: configMod?.curseForgeFileId
          };
          
          modsMap.set(file, modInfo);
        }
      }
    }
    
    return Array.from(modsMap.values());
  } catch (error) {
    console.error('Error loading installed mods:', error);
    return [];
  }
}

async function downloadMod(modInfo) {
  try {
    const modsPath = await getModsPath();
    
    if (!modInfo.downloadUrl && !modInfo.fileId) {
      throw new Error('No download URL or file ID provided');
    }
    
    let downloadUrl = modInfo.downloadUrl;
    
    if (!downloadUrl && modInfo.fileId && modInfo.modId) {
      const response = await axios.get(`https://api.curseforge.com/v1/mods/${modInfo.modId}/files/${modInfo.fileId}`, {
        headers: {
          'x-api-key': modInfo.apiKey,
          'Accept': 'application/json'
        }
      });
      
      downloadUrl = response.data.data.downloadUrl;
    }
    
    if (!downloadUrl) {
      throw new Error('Could not determine download URL');
    }
    
    const fileName = modInfo.fileName || `mod-${modInfo.modId}.jar`;
    const filePath = path.join(modsPath, fileName);
    
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const configMods = loadModsFromConfig();
        const newMod = {
          id: modInfo.id || generateModId(fileName),
          name: modInfo.name || extractModName(fileName),
          version: modInfo.version || '1.0.0',
          description: modInfo.summary || modInfo.description || 'Downloaded from CurseForge',
          author: modInfo.author || 'Unknown',
          enabled: true,
          fileName: fileName,
          fileSize: fs.statSync(filePath).size,
          dateInstalled: new Date().toISOString(),
          curseForgeId: modInfo.modId,
          curseForgeFileId: modInfo.fileId
        };
        
        configMods.push(newMod);
        saveModsToConfig(configMods);
        
        resolve({
          success: true,
          filePath: filePath,
          fileName: fileName,
          modInfo: newMod
        });
      });
      writer.on('error', reject);
    });
    
  } catch (error) {
    console.error('Error downloading mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function uninstallMod(modId, modsPath) {
  try {
    const configMods = loadModsFromConfig();
    const mod = configMods.find(m => m.id === modId);
    
    if (!mod) {
      throw new Error('Mod not found in config');
    }
    
    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    const enabledPath = path.join(modsPath, mod.fileName);
    const disabledPath = path.join(disabledModsPath, mod.fileName);
    
    let fileRemoved = false;
    if (fs.existsSync(enabledPath)) {
      fs.unlinkSync(enabledPath);
      fileRemoved = true;
      console.log('Removed mod from Mods folder:', enabledPath);
    } else if (fs.existsSync(disabledPath)) {
      fs.unlinkSync(disabledPath);
      fileRemoved = true;
      console.log('Removed mod from DisabledMods folder:', disabledPath);
    }
    
    if (!fileRemoved) {
      console.warn('Mod file not found on filesystem, removing from config anyway');
    }
    
    const updatedMods = configMods.filter(m => m.id !== modId);
    saveModsToConfig(updatedMods);
    console.log('Mod removed from config.json');
    
    return { success: true };
  } catch (error) {
    console.error('Error uninstalling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function toggleMod(modId, modsPath) {
  try {
    const mods = await loadInstalledMods(modsPath);
    const mod = mods.find(m => m.id === modId);
    
    if (!mod) {
      throw new Error('Mod not found');
    }

    const disabledModsPath = path.join(path.dirname(modsPath), 'DisabledMods');
    if (!fs.existsSync(disabledModsPath)) {
      fs.mkdirSync(disabledModsPath, { recursive: true });
    }

    const currentPath = mod.filePath;
    let newPath, newEnabled;

    if (mod.enabled) {
      newPath = path.join(disabledModsPath, path.basename(currentPath));
      newEnabled = false;
    } else {
      newPath = path.join(modsPath, path.basename(currentPath));
      newEnabled = true;
    }

    fs.renameSync(currentPath, newPath);
    
    const configMods = loadModsFromConfig();
    const configModIndex = configMods.findIndex(m => m.id === modId);
    if (configModIndex !== -1) {
      configMods[configModIndex].enabled = newEnabled;
      saveModsToConfig(configMods);
    }
    
    return { success: true, enabled: newEnabled };
  } catch (error) {
    console.error('Error toggling mod:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  loadInstalledMods,
  downloadMod,
  uninstallMod,
  toggleMod,
  generateModId,
  extractModName,
  extractVersion
};
