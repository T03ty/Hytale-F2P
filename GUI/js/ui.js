
let progressOverlay;
let progressBar;
let progressBarFill;
let progressText;
let progressPercent;
let progressSpeed;
let progressSize;

function showPage(pageId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => {
    if (page.id === pageId) {
      page.classList.add('active');
      page.style.display = '';
    } else {
      page.classList.remove('active');
      page.style.display = 'none';
    }
  });
}

function setActiveNav(page) {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-page') === page) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function handleNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const page = item.getAttribute('data-page');
      showPage(`${page}-page`);
      setActiveNav(page);
    });
  });
}

function setupWindowControls() {
  const minimizeBtn = document.querySelector('.window-controls .minimize');
  const closeBtn = document.querySelector('.window-controls .close');

  const windowControls = document.querySelector('.window-controls');
  const header = document.querySelector('.header');

  const profileSelector = document.querySelector('.profile-selector');

  if (profileSelector) {
    profileSelector.style.pointerEvents = 'auto';
    profileSelector.style.zIndex = '10000';
  }

  if (windowControls) {
    windowControls.style.pointerEvents = 'auto';
    windowControls.style.zIndex = '10000';
  }

  if (header) {
    header.style.webkitAppRegion = 'drag';
    if (windowControls) {
      windowControls.style.webkitAppRegion = 'no-drag';
    }
    if (profileSelector) {
      profileSelector.style.webkitAppRegion = 'no-drag';
    }
  }

  if (window.electronAPI) {
    if (minimizeBtn) {
      minimizeBtn.onclick = (e) => {
        e.stopPropagation();
        window.electronAPI.minimizeWindow();
      };
    }
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        window.electronAPI.closeWindow();
      };
    }
  }
}

function showLauncherOrInstall(isInstalled) {
  const launcher = document.getElementById('launcher-container');
  const install = document.getElementById('install-page');
  const sidebar = document.querySelector('.sidebar');
  const gameTitle = document.querySelector('.game-title-section');

  if (isInstalled) {
    if (launcher) launcher.style.display = '';
    if (install) install.style.display = 'none';
    if (sidebar) sidebar.style.pointerEvents = 'auto';
    if (gameTitle) gameTitle.style.display = '';
    showPage('play-page');
    setActiveNav('play');
  } else {
    if (launcher) launcher.style.display = 'none';
    if (install) {
      install.style.display = '';
      install.classList.add('active');
    }
    if (sidebar) sidebar.style.pointerEvents = 'none';
    if (gameTitle) gameTitle.style.display = 'none';
    const pages = document.querySelectorAll('#launcher-container .page');
    pages.forEach(page => page.classList.remove('active'));
  }
}

function setupSidebarLogo() {
  const logo = document.querySelector('.sidebar-logo img');
  if (logo) {
    logo.addEventListener('click', () => {
      showPage('play-page');
      setActiveNav('play');
    });
  }
}

function showProgress() {
  if (progressOverlay) {
    progressOverlay.style.display = 'block';
    setTimeout(() => {
      progressOverlay.style.opacity = '1';
      progressOverlay.style.transform = 'translateY(0)';
    }, 10);
  }
}

function hideProgress() {
  if (progressOverlay) {
    progressOverlay.style.opacity = '0';
    progressOverlay.style.transform = 'translateY(20px)';
    setTimeout(() => {
      progressOverlay.style.display = 'none';
    }, 300);
  }
}

function updateProgress(data) {
  if (data.message && progressText) {
    progressText.textContent = data.message;
  }

  if (data.percent !== null && data.percent !== undefined) {
    const percent = Math.min(100, Math.max(0, Math.round(data.percent)));
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
  }

  if (data.speed && data.downloaded && data.total) {
    const speedMB = (data.speed / 1024 / 1024).toFixed(2);
    const downloadedMB = (data.downloaded / 1024 / 1024).toFixed(2);
    const totalMB = (data.total / 1024 / 1024).toFixed(2);
    if (progressSpeed) progressSpeed.textContent = `${speedMB} MB/s`;
    if (progressSize) progressSize.textContent = `${downloadedMB} / ${totalMB} MB`;
  }
}

function setupAnimations() {
  document.body.style.opacity = '0';
  document.body.style.transform = 'translateY(20px)';

  setTimeout(() => {
    document.body.style.transition = 'all 0.6s ease';
    document.body.style.opacity = '1';
    document.body.style.transform = 'translateY(0)';
  }, 100);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}

function setupFirstLaunchHandlers() {
  console.log('Setting up first launch handlers...');

  window.electronAPI.onFirstLaunchUpdate((data) => {
    console.log('Received first launch update event:', data);
    showFirstLaunchUpdateDialog(data);
  });

  window.electronAPI.onFirstLaunchWelcome(() => {
  });

  window.electronAPI.onFirstLaunchProgress((data) => {
    showProgress();
    updateProgress(data);
  });

  let lockButtonTimeout = null;

  window.electronAPI.onLockPlayButton((locked) => {
    lockPlayButton(locked);

    if (locked) {
      if (lockButtonTimeout) {
        clearTimeout(lockButtonTimeout);
      }
      lockButtonTimeout = setTimeout(() => {
        console.warn('Play button has been locked for too long, forcing unlock');
        lockPlayButton(false);
        lockButtonTimeout = null;
      }, 20000);
    } else {
      if (lockButtonTimeout) {
        clearTimeout(lockButtonTimeout);
        lockButtonTimeout = null;
      }
    }
  });
}

function showFirstLaunchUpdateDialog(data) {
  console.log('Creating first launch modal...');

  const existingModal = document.querySelector('.first-launch-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'first-launch-modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    background: rgba(0, 0, 0, 0.95) !important;
    backdrop-filter: blur(10px) !important;
    z-index: 999999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: all !important;
  `;

  const modalDialog = document.createElement('div');
  modalDialog.className = 'first-launch-modal-dialog';
  modalDialog.style.cssText = `
    background: #1a1a1a !important;
    border-radius: 12px !important;
    padding: 0 !important;
    width: 500px !important;
    max-width: 90vw !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8) !important;
    border: 1px solid rgba(147, 51, 234, 0.5) !important;
    overflow: hidden !important;
    animation: modalSlideIn 0.3s ease-out !important;
  `;

  modalDialog.innerHTML = `
    <div style="background: linear-gradient(135deg, rgba(147, 51, 234, 0.2), rgba(59, 130, 246, 0.2)); padding: 25px; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <h2 style="margin: 0; color: #fff; font-size: 1.5rem; font-weight: 600; text-align: center;">
        🔄 Game Update Required
      </h2>
    </div>
    <div style="padding: 30px; color: #e5e7eb; line-height: 1.6;">
      <div style="text-align: center; margin-bottom: 25px;">
        <p style="font-size: 1.1rem; margin-bottom: 15px;">
          An existing Hytale installation has been detected and must be updated to the latest version.
        </p>
        <p style="color: #10b981; font-weight: 500; margin-bottom: 20px;">
          ✅ Your game saves and settings will be preserved
        </p>
      </div>
      
      <div style="background: rgba(59, 130, 246, 0.1); padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 20px 0;">
        <p style="margin: 8px 0; font-family: 'Courier New', monospace; font-size: 0.9em;">
          <strong>📁 Location:</strong> ${data.existingGame.installPath}
        </p>
        <p style="margin: 8px 0; font-family: 'Courier New', monospace; font-size: 0.9em;">
          <strong>💾 UserData:</strong> ${data.existingGame.hasUserData ? '✅ Found (will be preserved)' : '❌ Not found'}
        </p>
      </div>
      
      <div style="background: rgba(234, 179, 8, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid #eab308; margin: 20px 0;">
        <p style="margin: 0; color: #fbbf24; font-weight: 500; font-size: 0.95em;">
          ⚠️ This update is mandatory and cannot be skipped
        </p>
      </div>
    </div>
    <div style="padding: 25px; border-top: 1px solid rgba(255,255,255,0.1); text-align: center;">
      <button id="updateGameBtn" style="
        background: linear-gradient(135deg, #9333ea, #3b82f6) !important;
        color: white !important;
        border: none !important;
        padding: 15px 30px !important;
        border-radius: 8px !important;
        font-size: 1rem !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        min-width: 200px !important;
      " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
        🚀 Update Game Now
      </button>
    </div>
  `;

  modalOverlay.appendChild(modalDialog);

  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };

  document.addEventListener('keydown', function preventEscape(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  });

  document.body.appendChild(modalOverlay);

  const updateBtn = document.getElementById('updateGameBtn');
  updateBtn.onclick = () => {
    acceptFirstLaunchUpdate();
  };

  window.firstLaunchExistingGame = data.existingGame;

  console.log('First launch modal created and displayed');
}

function lockPlayButton(locked) {
  const playButton = document.getElementById('homePlayBtn');

  if (!playButton) {
    console.warn('Play button not found');
    return;
  }

  if (locked) {
    playButton.style.opacity = '0.5';
    playButton.style.pointerEvents = 'none';
    playButton.style.cursor = 'not-allowed';
    playButton.setAttribute('data-locked', 'true');

    const spanElement = playButton.querySelector('span');
    if (spanElement) {
      if (!playButton.getAttribute('data-original-text')) {
        playButton.setAttribute('data-original-text', spanElement.textContent);
      }
      spanElement.textContent = window.i18n ? window.i18n.t('play.checking') : 'CHECKING...';
    }

    console.log('Play button locked');
  } else {
    playButton.style.opacity = '';
    playButton.style.pointerEvents = '';
    playButton.style.cursor = '';
    playButton.removeAttribute('data-locked');

    const spanElement = playButton.querySelector('span');
    if (spanElement) {
      // Use i18n to get the current translation instead of restoring saved text
      spanElement.textContent = window.i18n ? window.i18n.t('play.playButton') : 'PLAY HYTALE';
      playButton.removeAttribute('data-original-text');
    }

    console.log('Play button unlocked');
  }
}



async function acceptFirstLaunchUpdate() {
  const existingGame = window.firstLaunchExistingGame;

  if (!existingGame) {
    const errorMsg = window.i18n ? window.i18n.t('notifications.gameDataNotFound') : 'Error: Game data not found';
    showNotification(errorMsg, 'error');
    return;
  }

  const modal = document.querySelector('.first-launch-modal-overlay');
  if (modal) {
    modal.style.pointerEvents = 'none';
    const btn = document.getElementById('updateGameBtn');
    if (btn) {
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '🔄 Updating...';
    }
  }

  try {
    showProgress();
    const updateMsg = window.i18n ? window.i18n.t('progress.startingUpdate') : 'Starting mandatory game update...';
    updateProgress({ message: updateMsg, percent: 0 });

    const result = await window.electronAPI.acceptFirstLaunchUpdate(existingGame);

    window.electronAPI.markAsLaunched && window.electronAPI.markAsLaunched();

    if (modal) {
      modal.remove();
    }

    lockPlayButton(false);

    if (result.success) {
      hideProgress();
      const successMsg = window.i18n ? window.i18n.t('notifications.gameUpdatedSuccess') : 'Game updated successfully! 🎉';
      showNotification(successMsg, 'success');
    } else {
      hideProgress();
      const errorMsg = window.i18n ? window.i18n.t('notifications.updateFailed').replace('{error}', result.error) : `Update failed: ${result.error}`;
      showNotification(errorMsg, 'error');
    }
  } catch (error) {
    if (modal) {
      modal.remove();
    }
    lockPlayButton(false);
    hideProgress();
    const errorMsg = window.i18n ? window.i18n.t('notifications.updateError').replace('{error}', error.message) : `Update error: ${error.message}`;
    showNotification(errorMsg, 'error');
  }
}

function dismissFirstLaunchDialog() {
  const modal = document.querySelector('.first-launch-modal-overlay');
  if (modal) {
    modal.remove();
  }

  lockPlayButton(false);
  window.electronAPI.markAsLaunched && window.electronAPI.markAsLaunched();
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 100);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

function setupUI() {
  progressOverlay = document.getElementById('progressOverlay');
  progressBar = document.getElementById('progressBar');
  progressBarFill = document.getElementById('progressBarFill');
  progressText = document.getElementById('progressText');
  progressPercent = document.getElementById('progressPercent');
  progressSpeed = document.getElementById('progressSpeed');
  progressSize = document.getElementById('progressSize');

  lockPlayButton(true);

  setTimeout(() => {
    const playButton = document.getElementById('homePlayBtn');
    if (playButton && playButton.getAttribute('data-locked') === 'true') {
      const spanElement = playButton.querySelector('span');
      if (spanElement && spanElement.textContent === 'CHECKING...') {
        console.warn('Play button still locked after startup timeout, forcing unlock');
        lockPlayButton(false);
      }
    }
  }, 25000);

  handleNavigation();
  setupWindowControls();
  setupSidebarLogo();
  setupAnimations();
  setupFirstLaunchHandlers();

  document.body.focus();
}

window.LauncherUI = {
  showPage,
  setActiveNav,
  showLauncherOrInstall,
  showProgress,
  hideProgress,
  updateProgress
};

document.addEventListener('DOMContentLoaded', setupUI);
