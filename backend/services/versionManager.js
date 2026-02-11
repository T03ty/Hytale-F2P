const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { getOS, getArch } = require('../utils/platformUtils');
const { smartRequest } = require('../utils/proxyClient');

const BASE_PATCH_URL = 'https://game-patches.hytale.com/patches';
const MANIFEST_API = 'https://files.hytalef2p.com/api/patch_manifest';
const NEW_API_URL = 'https://thecute.cloud/ShipOfYarn/api.php';

let apiCache = null;
let apiCacheTime = 0;
const API_CACHE_DURATION = 60000; // 1 minute

async function fetchNewAPI() {
  const now = Date.now();
  
  if (apiCache && (now - apiCacheTime) < API_CACHE_DURATION) {
    console.log('[NewAPI] Using cached API data');
    return apiCache;
  }
  
  try {
    console.log('[NewAPI] Fetching from:', NEW_API_URL);
    const response = await axios.get(NEW_API_URL, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });
    
    if (response.data && response.data.hytale) {
      apiCache = response.data;
      apiCacheTime = now;
      console.log('[NewAPI] API data fetched and cached successfully');
      return response.data;
    } else {
      throw new Error('Invalid API response structure');
    }
  } catch (error) {
    console.error('[NewAPI] Error fetching API:', error.message);
    if (apiCache) {
      console.log('[NewAPI] Using expired cache due to error');
      return apiCache;
    }
    throw error;
  }
}

async function getLatestVersionFromNewAPI(branch = 'release') {
  try {
    const apiData = await fetchNewAPI();
    const osName = getOS();
    const arch = getArch();
    
    let osKey = osName;
    if (osName === 'darwin') {
      osKey = 'mac';
    }
    
    const branchData = apiData.hytale[branch];
    if (!branchData || !branchData[osKey]) {
      throw new Error(`No data found for branch: ${branch}, OS: ${osKey}`);
    }
    
    const osData = branchData[osKey];
    
    const versions = Object.keys(osData).filter(key => key.endsWith('.pwr'));
    
    if (versions.length === 0) {
      throw new Error(`No .pwr files found for ${osKey}`);
    }
    
    const versionNumbers = versions.map(v => {
      const match = v.match(/v(\d+)/);
      return match ? parseInt(match[1]) : 0;
    });
    
    const latestVersionNumber = Math.max(...versionNumbers);
    console.log(`[NewAPI] Latest version number: ${latestVersionNumber} for branch ${branch}`);
    
    return `v${latestVersionNumber}`;
  } catch (error) {
    console.error('[NewAPI] Error getting latest version:', error.message);
    throw error;
  }
}

async function getPWRUrlFromNewAPI(branch = 'release', version = 'v8') {
  try {
    const apiData = await fetchNewAPI();
    const osName = getOS();
    const arch = getArch();
    
    let osKey = osName;
    if (osName === 'darwin') {
      osKey = 'mac';
    }
    
    let fileName;
    if (osName === 'windows') {
      fileName = `${version}-windows-amd64.pwr`;
    } else if (osName === 'linux') {
      fileName = `${version}-linux-amd64.pwr`;
    } else if (osName === 'darwin') {
      fileName = `${version}-darwin-arm64.pwr`;
    }
    
    const branchData = apiData.hytale[branch];
    if (!branchData || !branchData[osKey]) {
      throw new Error(`No data found for branch: ${branch}, OS: ${osKey}`);
    }
    
    const osData = branchData[osKey];
    const url = osData[fileName];
    
    if (!url) {
      throw new Error(`No URL found for ${fileName}`);
    }
    
    console.log(`[NewAPI] URL for ${fileName}: ${url}`);
    return url;
  } catch (error) {
    console.error('[NewAPI] Error getting PWR URL:', error.message);
    throw error;
  }
}

async function getLatestClientVersion(branch = 'release') {
  try {
    console.log(`[NewAPI] Fetching latest client version from new API (branch: ${branch})...`);
    
    // Utiliser la nouvelle API
    const latestVersion = await getLatestVersionFromNewAPI(branch);
    console.log(`[NewAPI] Latest client version for ${branch}: ${latestVersion}`);
    return latestVersion;
    
  } catch (error) {
    console.error('[NewAPI] Error fetching client version from new API:', error.message);
    console.log('[NewAPI] Falling back to old API...');
    
    // Fallback vers l'ancienne API si la nouvelle échoue
    try {
      const response = await smartRequest(`https://files.hytalef2p.com/api/version_client?branch=${branch}`, {
        timeout: 40000,
        headers: {
          'User-Agent': 'Hytale-F2P-Launcher'
        }
      });

      if (response.data && response.data.client_version) {
        const version = response.data.client_version;
        console.log(`Latest client version for ${branch} (old API): ${version}`);
        return version;
      } else {
        console.log('Warning: Invalid API response, falling back to latest known version (v8)');
        return 'v8';
      }
    } catch (fallbackError) {
      console.error('Error fetching client version from old API:', fallbackError.message);
      console.log('Warning: Both APIs unavailable, falling back to latest known version (v8)');
      return 'v8';
    }
  }
}

// Fonction utilitaire pour extraire le numéro de version
// Supporte les formats: "7.pwr", "v8", "v8-windows-amd64.pwr", etc.
function extractVersionNumber(version) {
  if (!version) return 0;
  
  // Nouveau format: "v8" ou "v8-xxx.pwr"
  const vMatch = version.match(/v(\d+)/);
  if (vMatch) {
    return parseInt(vMatch[1]);
  }
  
  // Ancien format: "7.pwr"
  const pwrMatch = version.match(/(\d+)\.pwr/);
  if (pwrMatch) {
    return parseInt(pwrMatch[1]);
  }
  
  // Fallback: essayer de parser directement
  const num = parseInt(version);
  return isNaN(num) ? 0 : num;
}

function buildArchiveUrl(buildNumber, branch = 'release') {
  const os = getOS();
  const arch = getArch();
  return `${BASE_PATCH_URL}/${os}/${arch}/${branch}/0/${buildNumber}.pwr`;
}

async function checkArchiveExists(buildNumber, branch = 'release') {
  const url = buildArchiveUrl(buildNumber, branch);
  try {
    const response = await axios.head(url, { timeout: 10000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function discoverAvailableVersions(latestKnown, branch = 'release', maxProbe = 50) {
  const available = [];
  const latest = extractVersionNumber(latestKnown);
  
  for (let i = latest; i >= Math.max(1, latest - maxProbe); i--) {
    const exists = await checkArchiveExists(i, branch);
    if (exists) {
      available.push(`${i}.pwr`);
    }
  }
  
  return available;
}

async function fetchPatchManifest(branch = 'release') {
  try {
    const os = getOS();
    const arch = getArch();
    const response = await smartRequest(`${MANIFEST_API}?branch=${branch}&os=${os}&arch=${arch}`, {
      timeout: 10000
    });
    return response.data.patches || {};
  } catch (error) {
    console.error('Failed to fetch patch manifest:', error.message);
    return {};
  }
}

async function extractVersionDetails(targetVersion, branch = 'release') {
  const buildNumber = extractVersionNumber(targetVersion);
  const previousBuild = buildNumber - 1;
  
  const manifest = await fetchPatchManifest(branch);
  const patchInfo = manifest[buildNumber];
  
  return {
    version: targetVersion,
    buildNumber: buildNumber,
    buildName: `HYTALE-Build-${buildNumber}`,
    fullUrl: patchInfo?.original_url || buildArchiveUrl(buildNumber, branch),
    differentialUrl: patchInfo?.patch_url || null,
    checksum: patchInfo?.patch_hash || null,
    sourceVersion: patchInfo?.from ? `${patchInfo.from}.pwr` : (previousBuild > 0 ? `${previousBuild}.pwr` : null),
    isDifferential: !!patchInfo?.proper_patch,
    releaseNotes: patchInfo?.patch_note || null
  };
}

function canUseDifferentialUpdate(currentVersion, targetDetails) {
  if (!targetDetails) return false;
  if (!targetDetails.differentialUrl) return false;
  if (!targetDetails.isDifferential) return false;
  
  if (!currentVersion) return false;
  
  const currentBuild = extractVersionNumber(currentVersion);
  const expectedSource = extractVersionNumber(targetDetails.sourceVersion);
  
  return currentBuild === expectedSource;
}

function needsIntermediatePatches(currentVersion, targetVersion) {
  if (!currentVersion) return [];
  
  const current = extractVersionNumber(currentVersion);
  const target = extractVersionNumber(targetVersion);
  
  const intermediates = [];
  for (let i = current + 1; i <= target; i++) {
    intermediates.push(`${i}.pwr`);
  }
  
  return intermediates;
}

async function computeFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function validateChecksum(filePath, expectedChecksum) {
  if (!expectedChecksum) return true;
  
  const actualChecksum = await computeFileChecksum(filePath);
  return actualChecksum === expectedChecksum;
}

function getInstalledClientVersion() {
  try {
    const { loadVersionClient } = require('../core/config');
    return loadVersionClient();
  } catch (err) {
    return null;
  }
}

module.exports = {
  getLatestClientVersion,
  buildArchiveUrl,
  checkArchiveExists,
  discoverAvailableVersions,
  extractVersionDetails,
  canUseDifferentialUpdate,
  needsIntermediatePatches,
  computeFileChecksum,
  validateChecksum,
  getInstalledClientVersion,
  fetchNewAPI,
  getLatestVersionFromNewAPI,
  getPWRUrlFromNewAPI,
  extractVersionNumber
};
