const { execSync } = require('child_process');
const fs = require('fs');

function getOS() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
}

function getArch() {
  return process.arch === 'x64' ? 'amd64' : process.arch;
}

function isWaylandSession() {
  if (process.platform !== 'linux') {
    return false;
  }
  
  const sessionType = process.env.XDG_SESSION_TYPE;
  const waylandDisplay = process.env.WAYLAND_DISPLAY;

  // Debug logging
  console.log(`[PlatformUtils] Checking Wayland: XDG_SESSION_TYPE=${sessionType}, WAYLAND_DISPLAY=${waylandDisplay}`);

  if (sessionType && sessionType.toLowerCase() === 'wayland') {
    return true;
  }
  
  if (waylandDisplay) {
    return true;
  }
  
  try {
    const sessionId = process.env.XDG_SESSION_ID;
    if (sessionId) {
      const output = execSync(`loginctl show-session ${sessionId} -p Type`, { encoding: 'utf8' });
      if (output && output.toLowerCase().includes('wayland')) {
        return true;
      }
    }
  } catch (err) {
  }
  
  return false;
}

function setupWaylandEnvironment() {
  if (process.platform !== 'linux') {
    return {};
  }

  // If the user has manually set SDL_VIDEODRIVER (e.g. to 'x11'), strictly respect it.
  if (process.env.SDL_VIDEODRIVER) {
    console.log(`User manually set SDL_VIDEODRIVER=${process.env.SDL_VIDEODRIVER}, ignoring internal Wayland configuration.`);
    return {};
  }
  
  if (!isWaylandSession()) {
    console.log('Detected X11 session, using default environment');
    return {};
  }
  
  console.log('Detected Wayland session, checking for Gamescope/Steam Deck...');
  
  const envVars = {};

  // Only set Ozone hint if not already set by user
  if (!process.env.ELECTRON_OZONE_PLATFORM_HINT) {
    envVars.ELECTRON_OZONE_PLATFORM_HINT = 'wayland';
  }

  // 2. DETECT GAMESCOPE / STEAM DECK
  // Native Wayland often fails for SDL games in Gaming Mode (gamescope), so we force X11 (XWayland).
  // Checks:
  // - XDG_CURRENT_DESKTOP == 'gamescope'
  // - SteamDeck=1 (often set in SteamOS)
  const currentDesktop = process.env.XDG_CURRENT_DESKTOP || '';
  const isGamescope = currentDesktop.toLowerCase() === 'gamescope' || process.env.SteamDeck === '1';
  
  if (isGamescope) {
    console.log('Gamescope / Steam Deck detected, forcing SDL_VIDEODRIVER=x11 for compatibility');
    envVars.SDL_VIDEODRIVER = 'x11';
  } else {
    // For standard desktop Wayland (GNOME, KDE), we leave SDL_VIDEODRIVER unset.
    // This allows SDL3/SDL2 to use its internal preference (Wayland > X11).
    // EXCEPT if it was somehow force-set to 'wayland' by the parent process (rare but possible),
    // we strictly want to allow fallback, so we might unset it if it was 'wayland'.
    // But since we checked process.env.SDL_VIDEODRIVER at the start, we know it's NOT set manually.
    
    // So we effectively do nothing for standard Wayland, letting SDL decide.
    console.log('Standard Wayland session detected, letting SDL decide backend (auto-fallback enabled).');
  }
  
  console.log('Wayland environment variables:', envVars);
  return envVars;
}

function detectGpu() {
  const platform = getOS();

  try {
    if (platform === 'linux') {
      return detectGpuLinux();
    } else if (platform === 'windows') {
      return detectGpuWindows();
    } else if (platform === 'darwin') {
      return detectGpuMac();
    } else {
      return { mode: 'integrated', vendor: 'intel', integratedName: 'Unknown', dedicatedName: null };
    }
  } catch (error) {
    console.warn('GPU detection failed, falling back to integrated:', error.message);
    return { mode: 'integrated', vendor: 'intel', integratedName: 'Unknown', dedicatedName: null };
  }
}

function detectGpuLinux() {
  const output = execSync('lspci -nn | grep \'VGA\\|3D\'', { encoding: 'utf8' });
  const lines = output.split('\n').filter(line => line.trim());

  let integratedName = null;
  let dedicatedName = null;
  let hasNvidia = false;
  let hasAmd = false;

  for (const line of lines) {
    if (line.includes('VGA') || line.includes('3D')) {
      const match = line.match(/\[([^\]]+)\]/g);
      let modelName = null;
      if (match && match.length >= 2) {
        modelName = match[1].slice(1, -1);
      }

      if (line.includes('10de:') || line.toLowerCase().includes('nvidia')) {
        hasNvidia = true;
        dedicatedName = "NVIDIA " + modelName || 'NVIDIA GPU';
        console.log('Detected NVIDIA GPU:', dedicatedName);
      } else if (line.includes('1002:') || line.toLowerCase().includes('amd') || line.toLowerCase().includes('radeon')) {
        hasAmd = true;
        dedicatedName = "AMD " + modelName || 'AMD GPU';
        console.log('Detected AMD GPU:', dedicatedName);
      } else if (line.includes('8086:') || line.toLowerCase().includes('intel')) {
        integratedName = "Intel " + modelName || 'Intel GPU';
        console.log('Detected Intel GPU:', integratedName);
      }
    }
  }

  if (hasNvidia) {
    return { mode: 'dedicated', vendor: 'nvidia', integratedName: integratedName || 'Intel GPU', dedicatedName };
  } else if (hasAmd) {
    return { mode: 'dedicated', vendor: 'amd', integratedName: integratedName || 'Intel GPU', dedicatedName };
  } else {
    return { mode: 'integrated', vendor: 'intel', integratedName: integratedName || 'Intel GPU', dedicatedName: null };
  }
}

function detectGpuWindows() {
  const output = execSync('wmic path win32_VideoController get name', { encoding: 'utf8' });
  const lines = output.split('\n').map(line => line.trim()).filter(line => line && line !== 'Name');

  let integratedName = null;
  let dedicatedName = null;
  let hasNvidia = false;
  let hasAmd = false;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('nvidia')) {
      hasNvidia = true;
      dedicatedName = line;
      console.log('Detected NVIDIA GPU:', dedicatedName);
    } else if (lowerLine.includes('amd') || lowerLine.includes('radeon')) {
      hasAmd = true;
      dedicatedName = line;
      console.log('Detected AMD GPU:', dedicatedName);
    } else if (lowerLine.includes('intel')) {
      integratedName = line;
      console.log('Detected Intel GPU:', integratedName);
    }
  }

  if (hasNvidia) {
    return { mode: 'dedicated', vendor: 'nvidia', integratedName: integratedName || 'Intel GPU', dedicatedName };
  } else if (hasAmd) {
    return { mode: 'dedicated', vendor: 'amd', integratedName: integratedName || 'Intel GPU', dedicatedName };
  } else {
    return { mode: 'integrated', vendor: 'intel', integratedName: integratedName || 'Intel GPU', dedicatedName: null };
  }
}

function detectGpuMac() {
  const output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
  const lines = output.split('\n');

  let integratedName = null;
  let dedicatedName = null;
  let hasNvidia = false;
  let hasAmd = false;

  for (const line of lines) {
    if (line.includes('Chipset Model:')) {
      const gpuName = line.split('Chipset Model:')[1].trim();
      const lowerGpu = gpuName.toLowerCase();
      if (lowerGpu.includes('nvidia')) {
        hasNvidia = true;
        dedicatedName = gpuName;
        console.log('Detected NVIDIA GPU:', dedicatedName);
      } else if (lowerGpu.includes('amd') || lowerGpu.includes('radeon')) {
        hasAmd = true;
        dedicatedName = gpuName;
        console.log('Detected AMD GPU:', dedicatedName);
      } else if (lowerGpu.includes('intel') || lowerGpu.includes('iris') || lowerGpu.includes('uhd')) {
        integratedName = gpuName;
        console.log('Detected Intel GPU:', integratedName);
      } else if (!dedicatedName && !integratedName) {
        // Fallback for Apple Silicon or other
        integratedName = gpuName;
      }
    }
  }

  if (hasNvidia) {
    return { mode: 'dedicated', vendor: 'nvidia', integratedName: integratedName || 'Integrated GPU', dedicatedName };
  } else if (hasAmd) {
    return { mode: 'dedicated', vendor: 'amd', integratedName: integratedName || 'Integrated GPU', dedicatedName };
  } else {
    return { mode: 'integrated', vendor: 'intel', integratedName: integratedName || 'Integrated GPU', dedicatedName: null };
  }
}

function setupGpuEnvironment(gpuPreference) {
  if (process.platform !== 'linux') {
    return {};
  }

  let finalPreference = gpuPreference;
  let detected = detectGpu();

  if (gpuPreference === 'auto') {
    finalPreference = detected.mode;
    console.log(`Auto-detected GPU: ${detected.vendor} (${detected.mode})`);
  }

  console.log('Preferred GPU set to:', finalPreference);

  const envVars = {};

  if (finalPreference === 'dedicated') {
    if (detected.vendor === 'nvidia') {
      envVars.__NV_PRIME_RENDER_OFFLOAD = '1';
      envVars.__GLX_VENDOR_LIBRARY_NAME = 'nvidia';
      const nvidiaEglFile = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
      if (fs.existsSync(nvidiaEglFile)) {
        envVars.__EGL_VENDOR_LIBRARY_FILENAMES = nvidiaEglFile;
      } else {
        console.warn('NVIDIA EGL vendor library file not found, not setting __EGL_VENDOR_LIBRARY_FILENAMES');
      }
    } else {
      envVars.DRI_PRIME = '1';
    }
    console.log('GPU environment variables:', envVars);
  } else {
    console.log('Using integrated GPU, no environment variables set');
  }
  return envVars;
}

module.exports = {
  getOS,
  getArch,
  isWaylandSession,
  setupWaylandEnvironment,
  detectGpu,
  setupGpuEnvironment
};
