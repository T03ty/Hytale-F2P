import './ui.js';
import './install.js';
import './launcher.js';
import './news.js';
import './mods.js';
import './players.js';
import './chat.js';
import './settings.js';
import './logs.js';

// Initialize i18n immediately (before DOMContentLoaded)
let i18nInitialized = false;
(async () => {
  const savedLang = await window.electronAPI?.loadLanguage();
  await i18n.init(savedLang);
  i18nInitialized = true;
  
  // Update language selector if DOM is already loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    updateLanguageSelector();
  }
})();

function updateLanguageSelector() {
  const langSelect = document.getElementById('languageSelect');
  if (langSelect) {
    // Clear existing options
    langSelect.innerHTML = '';
    
    const languages = i18n.getAvailableLanguages();
    const currentLang = i18n.getCurrentLanguage();
    
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.name;
      if (lang.code === currentLang) {
        option.selected = true;
      }
      langSelect.appendChild(option);
    });
    
    // Handle language change (add listener only once)
    if (!langSelect.hasAttribute('data-listener-added')) {
      langSelect.addEventListener('change', async (e) => {
        await i18n.setLanguage(e.target.value);
      });
      langSelect.setAttribute('data-listener-added', 'true');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Populate language selector (wait for i18n if needed)
  if (i18nInitialized) {
    updateLanguageSelector();
  }
  
  // Discord notification
  const notification = document.getElementById('discordNotification');
  if (notification) {
    const dismissed = localStorage.getItem('discordNotificationDismissed');
    if (!dismissed) {
      setTimeout(() => {
        notification.style.display = 'flex';
      }, 3000);
    } else {
      notification.style.display = 'none';
    }
  }
});

window.closeDiscordNotification = function() {
  const notification = document.getElementById('discordNotification');
  if (notification) {
    notification.classList.add('hidden');
    setTimeout(() => {
      notification.style.display = 'none';
    }, 300);
  }
  localStorage.setItem('discordNotificationDismissed', 'true');
};