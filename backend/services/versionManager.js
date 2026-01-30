const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { getOS, getArch } = require('../utils/platformUtils');

const BASE_PATCH_URL = 'https://game-patches.hytale.com/patches';
const MANIFEST_API = 'https://files.hytalef2p.com/api/patch_manifest';

async function getLatestClientVersion(branch = 'release') {
  try {
    console.log(`Fetching latest client version from API (branch: ${branch})...`);
    const response = await axios.get('https://files.hytalef2p.com/api/version_client', {
      params: { branch },
      timeout: 40000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Latest client version for ${branch}: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid API response, falling back to latest known version (7.pwr)');
      return '7.pwr';
    }
  } catch (error) {
    console.error('Error fetching client version:', error.message);
    console.log('Warning: API unavailable, falling back to latest known version (7.pwr)');
    return '7.pwr';
  }
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
  const latest = parseInt(latestKnown.replace('.pwr', ''));
  
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
    const response = await axios.get(MANIFEST_API, {
      params: { branch, os, arch },
      timeout: 10000
    });
    return response.data.patches || {};
  } catch (error) {
    console.error('Failed to fetch patch manifest:', error.message);
    return {};
  }
}

async function extractVersionDetails(targetVersion, branch = 'release') {
  const buildNumber = parseInt(targetVersion.replace('.pwr', ''));
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
  
  const currentBuild = parseInt(currentVersion.replace('.pwr', ''));
  const expectedSource = parseInt(targetDetails.sourceVersion?.replace('.pwr', '') || '0');
  
  return currentBuild === expectedSource;
}

function needsIntermediatePatches(currentVersion, targetVersion) {
  if (!currentVersion) return [];
  
  const current = parseInt(currentVersion.replace('.pwr', ''));
  const target = parseInt(targetVersion.replace('.pwr', ''));
  
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
  getInstalledClientVersion
};
