const fs = require('fs');
const path = require('path');

// Domain configuration
const ORIGINAL_DOMAIN = 'hytale.com';
const MIN_DOMAIN_LENGTH = 4;
const MAX_DOMAIN_LENGTH = 16;

function getTargetDomain() {
  if (process.env.HYTALE_AUTH_DOMAIN) {
    return process.env.HYTALE_AUTH_DOMAIN;
  }
  try {
    const { getAuthDomain } = require('../core/config');
    return getAuthDomain();
  } catch (e) {
    return 'auth.sanasol.ws';
  }
}

const DEFAULT_NEW_DOMAIN = 'auth.sanasol.ws';

/**
 * Patches HytaleClient binary to replace hytale.com with custom domain
 * Server patching is done via pre-patched JAR download from CDN
 *
 * Supports domains from 4 to 16 characters:
 * - All F2P traffic routes to single endpoint: https://{domain} (no subdomains)
 * - Domains <= 10 chars: Direct replacement, subdomains stripped
 * - Domains 11-16 chars: Split mode - first 6 chars replace subdomain prefix, rest replaces domain
 */
class ClientPatcher {
  constructor() {
    this.patchedFlag = '.patched_custom';
  }

  /**
   * Get the target domain for patching
   */
  getNewDomain() {
    const domain = getTargetDomain();
    if (domain.length < MIN_DOMAIN_LENGTH) {
      console.warn(`Warning: Domain "${domain}" is too short (min ${MIN_DOMAIN_LENGTH} chars)`);
      console.warn(`Using default domain: ${DEFAULT_NEW_DOMAIN}`);
      return DEFAULT_NEW_DOMAIN;
    }
    if (domain.length > MAX_DOMAIN_LENGTH) {
      console.warn(`Warning: Domain "${domain}" is too long (max ${MAX_DOMAIN_LENGTH} chars)`);
      console.warn(`Using default domain: ${DEFAULT_NEW_DOMAIN}`);
      return DEFAULT_NEW_DOMAIN;
    }
    return domain;
  }

  /**
   * Calculate the domain patching strategy based on length
   */
  getDomainStrategy(domain) {
    if (domain.length <= 10) {
      return {
        mode: 'direct',
        mainDomain: domain,
        subdomainPrefix: '',
        description: `Direct replacement: hytale.com -> ${domain}`
      };
    } else {
      const prefix = domain.slice(0, 6);
      const suffix = domain.slice(6);
      return {
        mode: 'split',
        mainDomain: suffix,
        subdomainPrefix: prefix,
        description: `Split mode: subdomain prefix="${prefix}", main domain="${suffix}"`
      };
    }
  }

  /**
   * Convert a string to the length-prefixed byte format used by the client
   */
  stringToLengthPrefixed(str) {
    const length = str.length;
    const result = Buffer.alloc(4 + length + (length - 1));
    result[0] = length;
    result[1] = 0x00;
    result[2] = 0x00;
    result[3] = 0x00;

    let pos = 4;
    for (let i = 0; i < length; i++) {
      result[pos++] = str.charCodeAt(i);
      if (i < length - 1) {
        result[pos++] = 0x00;
      }
    }
    return result;
  }

  /**
   * Convert a string to UTF-16LE bytes (how .NET stores strings)
   */
  stringToUtf16LE(str) {
    const buf = Buffer.alloc(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      buf.writeUInt16LE(str.charCodeAt(i), i * 2);
    }
    return buf;
  }

  /**
   * Find all occurrences of a pattern in a buffer
   */
  findAllOccurrences(buffer, pattern) {
    const positions = [];
    let pos = 0;
    while (pos < buffer.length) {
      const index = buffer.indexOf(pattern, pos);
      if (index === -1) break;
      positions.push(index);
      pos = index + 1;
    }
    return positions;
  }

  /**
   * Replace bytes in buffer - only overwrites the length of new bytes
   */
  replaceBytes(buffer, oldBytes, newBytes) {
    let count = 0;
    const result = Buffer.from(buffer);

    if (newBytes.length > oldBytes.length) {
      console.warn(`  Warning: New pattern (${newBytes.length}) longer than old (${oldBytes.length}), skipping`);
      return { buffer: result, count: 0 };
    }

    const positions = this.findAllOccurrences(result, oldBytes);
    for (const pos of positions) {
      newBytes.copy(result, pos);
      count++;
    }

    return { buffer: result, count };
  }

  /**
   * Smart domain replacement that handles both null-terminated and non-null-terminated strings
   */
  findAndReplaceDomainSmart(data, oldDomain, newDomain) {
    let count = 0;
    const result = Buffer.from(data);

    const oldUtf16NoLast = this.stringToUtf16LE(oldDomain.slice(0, -1));
    const newUtf16NoLast = this.stringToUtf16LE(newDomain.slice(0, -1));

    const oldLastCharByte = oldDomain.charCodeAt(oldDomain.length - 1);
    const newLastCharByte = newDomain.charCodeAt(newDomain.length - 1);

    const positions = this.findAllOccurrences(result, oldUtf16NoLast);

    for (const pos of positions) {
      const lastCharPos = pos + oldUtf16NoLast.length;
      if (lastCharPos + 1 > result.length) continue;

      const lastCharFirstByte = result[lastCharPos];

      if (lastCharFirstByte === oldLastCharByte) {
        newUtf16NoLast.copy(result, pos);
        result[lastCharPos] = newLastCharByte;

        if (lastCharPos + 1 < result.length) {
          const secondByte = result[lastCharPos + 1];
          if (secondByte === 0x00) {
            console.log(`  Patched UTF-16LE occurrence at offset 0x${pos.toString(16)}`);
          } else {
            console.log(`  Patched length-prefixed occurrence at offset 0x${pos.toString(16)} (metadata: 0x${secondByte.toString(16)})`);
          }
        }
        count++;
      }
    }

    return { buffer: result, count };
  }

  /**
   * Apply all domain patches using length-prefixed format
   */
  applyDomainPatches(data, domain, protocol = 'https://') {
    let result = Buffer.from(data);
    let totalCount = 0;
    const strategy = this.getDomainStrategy(domain);

    console.log(`  Patching strategy: ${strategy.description}`);

    // 1. Patch telemetry/sentry URL
    const oldSentry = 'https://ca900df42fcf57d4dd8401a86ddd7da2@sentry.hytale.com/2';
    const newSentry = `${protocol}t@${domain}/2`;

    console.log(`  Patching sentry: ${oldSentry.slice(0, 30)}... -> ${newSentry}`);
    const sentryResult = this.replaceBytes(
      result,
      this.stringToLengthPrefixed(oldSentry),
      this.stringToLengthPrefixed(newSentry)
    );
    result = sentryResult.buffer;
    if (sentryResult.count > 0) {
      console.log(`    Replaced ${sentryResult.count} sentry occurrence(s)`);
      totalCount += sentryResult.count;
    }

    // 2. Patch main domain
    console.log(`  Patching domain: ${ORIGINAL_DOMAIN} -> ${strategy.mainDomain}`);
    const domainResult = this.replaceBytes(
      result,
      this.stringToLengthPrefixed(ORIGINAL_DOMAIN),
      this.stringToLengthPrefixed(strategy.mainDomain)
    );
    result = domainResult.buffer;
    if (domainResult.count > 0) {
      console.log(`    Replaced ${domainResult.count} domain occurrence(s)`);
      totalCount += domainResult.count;
    }

    // 3. Patch subdomain prefixes
    const subdomains = ['https://tools.', 'https://sessions.', 'https://account-data.', 'https://telemetry.'];
    const newSubdomainPrefix = protocol + strategy.subdomainPrefix;

    for (const sub of subdomains) {
      console.log(`  Patching subdomain: ${sub} -> ${newSubdomainPrefix}`);
      const subResult = this.replaceBytes(
        result,
        this.stringToLengthPrefixed(sub),
        this.stringToLengthPrefixed(newSubdomainPrefix)
      );
      result = subResult.buffer;
      if (subResult.count > 0) {
        console.log(`    Replaced ${subResult.count} occurrence(s)`);
        totalCount += subResult.count;
      }
    }

    return { buffer: result, count: totalCount };
  }

  /**
   * Patch Discord invite URLs
   */
  patchDiscordUrl(data) {
    let count = 0;
    const result = Buffer.from(data);

    const oldUrl = '.gg/hytale';
    const newUrl = '.gg/hf2pdc';

    const lpResult = this.replaceBytes(
      result,
      this.stringToLengthPrefixed(oldUrl),
      this.stringToLengthPrefixed(newUrl)
    );

    if (lpResult.count > 0) {
      return { buffer: lpResult.buffer, count: lpResult.count };
    }

    // Fallback to UTF-16LE
    const oldUtf16 = this.stringToUtf16LE(oldUrl);
    const newUtf16 = this.stringToUtf16LE(newUrl);

    const positions = this.findAllOccurrences(result, oldUtf16);
    for (const pos of positions) {
      newUtf16.copy(result, pos);
      count++;
    }

    return { buffer: result, count };
  }

  /**
   * Check patch status of client binary
   */
  getPatchStatus(clientPath) {
    const newDomain = this.getNewDomain();
    const patchFlagFile = clientPath + this.patchedFlag;

    if (fs.existsSync(patchFlagFile)) {
      try {
        const flagData = JSON.parse(fs.readFileSync(patchFlagFile, 'utf8'));
        const currentDomain = flagData.targetDomain;

        if (currentDomain === newDomain) {
          const data = fs.readFileSync(clientPath);
          const strategy = this.getDomainStrategy(newDomain);
          const domainPattern = this.stringToLengthPrefixed(strategy.mainDomain);

          if (data.includes(domainPattern)) {
            return { patched: true, currentDomain, needsRestore: false };
          } else {
            console.log('  Flag exists but binary not patched (was updated?), needs re-patching...');
            return { patched: false, currentDomain: null, needsRestore: false };
          }
        } else {
          console.log(`  Currently patched for "${currentDomain}", need to change to "${newDomain}"`);
          return { patched: false, currentDomain, needsRestore: true };
        }
      } catch (e) {
        // Flag file corrupt
      }
    }
    return { patched: false, currentDomain: null, needsRestore: false };
  }

  /**
   * Check if client is already patched (backward compat)
   */
  isPatchedAlready(clientPath) {
    return this.getPatchStatus(clientPath).patched;
  }

  /**
   * Restore client from backup
   */
  restoreFromBackup(clientPath) {
    const backupPath = clientPath + '.original';
    if (fs.existsSync(backupPath)) {
      console.log('  Restoring original binary from backup for re-patching...');
      fs.copyFileSync(backupPath, clientPath);
      const patchFlagFile = clientPath + this.patchedFlag;
      if (fs.existsSync(patchFlagFile)) {
        fs.unlinkSync(patchFlagFile);
      }
      return true;
    }
    console.warn('  No backup found to restore - will try patching anyway');
    return false;
  }

  /**
   * Mark client as patched
   */
  markAsPatched(clientPath) {
    const newDomain = this.getNewDomain();
    const strategy = this.getDomainStrategy(newDomain);
    const patchFlagFile = clientPath + this.patchedFlag;
    const flagData = {
      patchedAt: new Date().toISOString(),
      originalDomain: ORIGINAL_DOMAIN,
      targetDomain: newDomain,
      patchMode: strategy.mode,
      mainDomain: strategy.mainDomain,
      subdomainPrefix: strategy.subdomainPrefix,
      patcherVersion: '2.1.0',
      verified: 'binary_contents'
    };
    fs.writeFileSync(patchFlagFile, JSON.stringify(flagData, null, 2));
  }

  /**
   * Create backup of original client binary
   */
  backupClient(clientPath) {
    const backupPath = clientPath + '.original';
    try {
      if (!fs.existsSync(backupPath)) {
        console.log(`  Creating backup at ${path.basename(backupPath)}`);
        fs.copyFileSync(clientPath, backupPath);
        return backupPath;
      }

      const currentSize = fs.statSync(clientPath).size;
      const backupSize = fs.statSync(backupPath).size;

      if (currentSize !== backupSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const oldBackupPath = `${clientPath}.original.${timestamp}`;
        console.log(`  File updated, archiving old backup to ${path.basename(oldBackupPath)}`);
        fs.renameSync(backupPath, oldBackupPath);
        fs.copyFileSync(clientPath, backupPath);
        return backupPath;
      }

      console.log('  Backup already exists');
      return backupPath;
    } catch (e) {
      console.error(`  Failed to create backup: ${e.message}`);
      return null;
    }
  }

  /**
   * Restore original client binary
   */
  restoreClient(clientPath) {
    const backupPath = clientPath + '.original';
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, clientPath);
      const patchFlagFile = clientPath + this.patchedFlag;
      if (fs.existsSync(patchFlagFile)) {
        fs.unlinkSync(patchFlagFile);
      }
      console.log('Client restored from backup');
      return true;
    }
    console.log('No backup found to restore');
    return false;
  }

  /**
   * Patch the client binary to use the custom domain
   */
  async patchClient(clientPath, progressCallback) {
    const newDomain = this.getNewDomain();
    const strategy = this.getDomainStrategy(newDomain);

    console.log('=== Client Patcher v2.1 ===');
    console.log(`Target: ${clientPath}`);
    console.log(`Domain: ${newDomain} (${newDomain.length} chars)`);
    console.log(`Mode: ${strategy.mode}`);
    if (strategy.mode === 'split') {
      console.log(`  Subdomain prefix: ${strategy.subdomainPrefix}`);
      console.log(`  Main domain: ${strategy.mainDomain}`);
    }

    if (!fs.existsSync(clientPath)) {
      const error = `Client binary not found: ${clientPath}`;
      console.error(error);
      return { success: false, error };
    }

    const patchStatus = this.getPatchStatus(clientPath);

    if (patchStatus.patched) {
      console.log(`Client already patched for ${newDomain}, skipping`);
      if (progressCallback) progressCallback('Client already patched', 100);
      return { success: true, alreadyPatched: true, patchCount: 0 };
    }

    if (patchStatus.needsRestore) {
      if (progressCallback) progressCallback('Restoring original for domain change...', 5);
      this.restoreFromBackup(clientPath);
    }

    if (progressCallback) progressCallback('Preparing to patch client...', 10);

    console.log('Creating backup...');
    const backupResult = this.backupClient(clientPath);
    if (!backupResult) {
      console.warn('  Could not create backup - proceeding without backup');
    }

    if (progressCallback) progressCallback('Reading client binary...', 20);

    console.log('Reading client binary...');
    const data = fs.readFileSync(clientPath);
    console.log(`Binary size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

    if (progressCallback) progressCallback('Patching domain references...', 50);

    console.log('Applying domain patches (length-prefixed format)...');
    const { buffer: patchedData, count } = this.applyDomainPatches(data, newDomain);

    console.log('Patching Discord URLs...');
    const { buffer: finalData, count: discordCount } = this.patchDiscordUrl(patchedData);

    if (count === 0 && discordCount === 0) {
      console.log('No occurrences found - trying legacy UTF-16LE format...');

      const legacyResult = this.findAndReplaceDomainSmart(data, ORIGINAL_DOMAIN, strategy.mainDomain);
      if (legacyResult.count > 0) {
        console.log(`Found ${legacyResult.count} occurrences with legacy format`);
        fs.writeFileSync(clientPath, legacyResult.buffer);
        this.markAsPatched(clientPath);
        return { success: true, patchCount: legacyResult.count, format: 'legacy' };
      }

      console.log('No occurrences found - binary may already be modified or has different format');
      return { success: true, patchCount: 0, warning: 'No occurrences found' };
    }

    if (progressCallback) progressCallback('Writing patched binary...', 80);

    console.log('Writing patched binary...');
    fs.writeFileSync(clientPath, finalData);

    this.markAsPatched(clientPath);

    if (progressCallback) progressCallback('Patching complete', 100);

    console.log(`Successfully patched ${count} domain occurrences and ${discordCount} Discord URLs`);
    console.log('=== Patching Complete ===');

    return { success: true, patchCount: count + discordCount };
  }

  /**
   * Check if server JAR contains DualAuth classes (was patched)
   */
  serverJarContainsDualAuth(serverPath) {
    try {
      const data = fs.readFileSync(serverPath);
      // Check for DualAuthContext class signature in JAR
      const signature = Buffer.from('DualAuthContext', 'utf8');
      return data.includes(signature);
    } catch (e) {
      return false;
    }
  }

  /**
   * Validate downloaded file is not corrupt/partial
   * Server JAR should be at least 50MB
   */
  validateServerJarSize(serverPath) {
    try {
      const stats = fs.statSync(serverPath);
      const minSize = 50 * 1024 * 1024; // 50MB minimum
      if (stats.size < minSize) {
        console.error(`  Downloaded JAR too small: ${(stats.size / 1024 / 1024).toFixed(2)} MB (expected >50MB)`);
        return false;
      }
      console.log(`  Downloaded size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Patch server JAR by downloading pre-patched version from CDN
   */
  async patchServer(serverPath, progressCallback, branch = 'release') {
    const newDomain = this.getNewDomain();

    console.log('=== Server Patcher (Pre-patched Download) ===');
    console.log(`Target: ${serverPath}`);
    console.log(`Branch: ${branch}`);
    console.log(`Domain: ${newDomain}`);

    if (!fs.existsSync(serverPath)) {
      const error = `Server JAR not found: ${serverPath}`;
      console.error(error);
      return { success: false, error };
    }

    // Check if already patched
    const patchFlagFile = serverPath + '.dualauth_patched';
    let needsRestore = false;

    if (fs.existsSync(patchFlagFile)) {
      try {
        const flagData = JSON.parse(fs.readFileSync(patchFlagFile, 'utf8'));
        if (flagData.domain === newDomain && flagData.branch === branch) {
          // Verify JAR actually contains DualAuth classes (game may have auto-updated)
          if (this.serverJarContainsDualAuth(serverPath)) {
            console.log(`Server already patched for ${newDomain} (${branch}), skipping`);
            if (progressCallback) progressCallback('Server already patched', 100);
            return { success: true, alreadyPatched: true };
          } else {
            console.log('  Flag exists but JAR not patched (was auto-updated?), will re-download...');
            // Delete stale flag file
            try { fs.unlinkSync(patchFlagFile); } catch (e) { /* ignore */ }
          }
        } else {
          console.log(`Server patched for "${flagData.domain}" (${flagData.branch}), need to change to "${newDomain}" (${branch})`);
          needsRestore = true;
        }
      } catch (e) {
        // Flag file corrupt, re-patch
        console.log('  Flag file corrupt, will re-download');
        try { fs.unlinkSync(patchFlagFile); } catch (e) { /* ignore */ }
      }
    }

    // Restore backup if patched for different domain
    if (needsRestore) {
      const backupPath = serverPath + '.original';
      if (fs.existsSync(backupPath)) {
        if (progressCallback) progressCallback('Restoring original for domain change...', 5);
        console.log('Restoring original JAR from backup for re-patching...');
        fs.copyFileSync(backupPath, serverPath);
        if (fs.existsSync(patchFlagFile)) {
          fs.unlinkSync(patchFlagFile);
        }
      } else {
        console.warn('  No backup found to restore - will download fresh patched JAR');
      }
    }

    // Create backup
    if (progressCallback) progressCallback('Creating backup...', 10);
    console.log('Creating backup...');
    const backupResult = this.backupClient(serverPath);
    if (!backupResult) {
      console.warn('  Could not create backup - proceeding without backup');
    }

    // Only support standard domain (auth.sanasol.ws) via pre-patched download
    if (newDomain !== 'auth.sanasol.ws' && newDomain !== 'sanasol.ws') {
      console.error(`Domain "${newDomain}" requires DualAuthPatcher - only auth.sanasol.ws is supported via pre-patched download`);
      return { success: false, error: `Unsupported domain: ${newDomain}. Only auth.sanasol.ws is supported.` };
    }

    // Download pre-patched JAR
    if (progressCallback) progressCallback('Downloading patched server JAR...', 30);
    console.log('Downloading pre-patched HytaleServer.jar...');

    try {
      const https = require('https');
      
      // Use different URL for pre-release vs release
      let url;
      if (branch === 'pre-release') {
        url = 'https://patcher.authbp.xyz/download/patched_prerelease';
        console.log('  Using pre-release patched server from:', url);
      } else {
        url = 'https://patcher.authbp.xyz/download/patched_release';
        console.log('  Using release patched server from:', url);
      }

      await new Promise((resolve, reject) => {
        const handleResponse = (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            https.get(response.headers.location, handleResponse).on('error', reject);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
            return;
          }

          const file = fs.createWriteStream(serverPath);
          const totalSize = parseInt(response.headers['content-length'], 10);
          let downloaded = 0;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            if (progressCallback && totalSize) {
              const percent = 30 + Math.floor((downloaded / totalSize) * 60);
              progressCallback(`Downloading... ${(downloaded / 1024 / 1024).toFixed(2)} MB`, percent);
            }
          });

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        };

        https.get(url, handleResponse).on('error', (err) => {
          fs.unlink(serverPath, () => {});
          reject(err);
        });
      });

      console.log('  Download successful');

      // Verify downloaded JAR size and contents
      if (progressCallback) progressCallback('Verifying downloaded JAR...', 95);

      if (!this.validateServerJarSize(serverPath)) {
        console.error('Downloaded JAR appears corrupt or incomplete');

        // Restore backup on verification failure
        const backupPath = serverPath + '.original';
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, serverPath);
          console.log('Restored backup after verification failure');
        }

        return { success: false, error: 'Downloaded JAR verification failed - file too small (corrupt/partial download)' };
      }

      if (!this.serverJarContainsDualAuth(serverPath)) {
        console.error('Downloaded JAR does not contain DualAuth classes - invalid or corrupt download');

        // Restore backup on verification failure
        const backupPath = serverPath + '.original';
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, serverPath);
          console.log('Restored backup after verification failure');
        }

        return { success: false, error: 'Downloaded JAR verification failed - missing DualAuth classes' };
      }
      console.log('  Verification successful - DualAuth classes present');

      // Mark as patched
      const sourceUrl = branch === 'pre-release' 
        ? 'https://patcher.authbp.xyz/download/patched_prerelease'
        : 'https://patcher.authbp.xyz/download/patched_release';
      
      fs.writeFileSync(patchFlagFile, JSON.stringify({
        domain: newDomain,
        branch: branch,
        patchedAt: new Date().toISOString(),
        patcher: 'PrePatchedDownload',
        source: sourceUrl
      }));

      if (progressCallback) progressCallback('Server patching complete', 100);
      console.log('=== Server Patching Complete ===');
      return { success: true, patchCount: 1 };

    } catch (downloadError) {
      console.error(`Failed to download patched JAR: ${downloadError.message}`);

      // Restore backup on failure
      const backupPath = serverPath + '.original';
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, serverPath);
        console.log('Restored backup after download failure');
      }

      return { success: false, error: `Failed to download patched server: ${downloadError.message}` };
    }
  }

  /**
   * Find client binary path based on platform
   */
  findClientPath(gameDir) {
    const candidates = [];

    if (process.platform === 'darwin') {
      candidates.push(path.join(gameDir, 'Client', 'Hytale.app', 'Contents', 'MacOS', 'HytaleClient'));
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient'));
    } else if (process.platform === 'win32') {
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient.exe'));
    } else {
      candidates.push(path.join(gameDir, 'Client', 'HytaleClient'));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Find server JAR path
   */
  findServerPath(gameDir) {
    const candidates = [
      path.join(gameDir, 'Server', 'HytaleServer.jar'),
      path.join(gameDir, 'Server', 'server.jar')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Ensure both client and server are patched before launching
   */
  async ensureClientPatched(gameDir, progressCallback, javaPath = null, branch = 'release') {
    const results = {
      client: null,
      server: null,
      success: true
    };

    const clientPath = this.findClientPath(gameDir);
    if (clientPath) {
      if (progressCallback) progressCallback('Patching client binary...', 10);
      results.client = await this.patchClient(clientPath, (msg, pct) => {
        if (progressCallback) {
          progressCallback(`Client: ${msg}`, pct ? pct / 2 : null);
        }
      });
    } else {
      console.warn('Could not find HytaleClient binary');
      results.client = { success: false, error: 'Client binary not found' };
    }

    const serverPath = this.findServerPath(gameDir);
    if (serverPath) {
      if (progressCallback) progressCallback('Patching server JAR...', 50);
      results.server = await this.patchServer(serverPath, (msg, pct) => {
        if (progressCallback) {
          progressCallback(`Server: ${msg}`, pct ? 50 + pct / 2 : null);
        }
      }, branch);
    } else {
      console.warn('Could not find HytaleServer.jar');
      results.server = { success: false, error: 'Server JAR not found' };
    }

    results.success = (results.client && results.client.success) || (results.server && results.server.success);
    results.alreadyPatched = (results.client && results.client.alreadyPatched) && (results.server && results.server.alreadyPatched);
    results.patchCount = (results.client ? results.client.patchCount || 0 : 0) + (results.server ? results.server.patchCount || 0 : 0);

    if (progressCallback) progressCallback('Patching complete', 100);

    return results;
  }
}

module.exports = new ClientPatcher();
