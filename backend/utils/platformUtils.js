const { execSync } = require('child_process');

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
  if (sessionType && sessionType.toLowerCase() === 'wayland') {
    return true;
  }
  
  if (process.env.WAYLAND_DISPLAY) {
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
  
  if (!isWaylandSession()) {
    console.log('Detected X11 session, using default environment');
    return {};
  }
  
  console.log('Detected Wayland session, configuring environment...');
  
  const envVars = {
    SDL_VIDEODRIVER: 'wayland',
    GDK_BACKEND: 'wayland',
    QT_QPA_PLATFORM: 'wayland',
    MOZ_ENABLE_WAYLAND: '1',
    _JAVA_AWT_WM_NONREPARENTING: '1'
  };
  
  envVars.ELECTRON_OZONE_PLATFORM_HINT = 'wayland';
  
  console.log('Wayland environment variables:', envVars);
  return envVars;
}

module.exports = {
  getOS,
  getArch,
  isWaylandSession,
  setupWaylandEnvironment
};
