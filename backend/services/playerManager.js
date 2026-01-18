const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PLAYER_ID_FILE, APP_DIR } = require('../core/paths');

function getOrCreatePlayerId() {
  try {
    if (!fs.existsSync(APP_DIR)) {
      fs.mkdirSync(APP_DIR, { recursive: true });
    }

    if (fs.existsSync(PLAYER_ID_FILE)) {
      const data = JSON.parse(fs.readFileSync(PLAYER_ID_FILE, 'utf8'));
      if (data.playerId) {
        return data.playerId;
      }
    }

    const newPlayerId = uuidv4();
    fs.writeFileSync(PLAYER_ID_FILE, JSON.stringify({
      playerId: newPlayerId,
      createdAt: new Date().toISOString()
    }, null, 2));

    return newPlayerId;
  } catch (error) {
    console.error('Error managing player ID:', error);
    return uuidv4();
  }
}

module.exports = {
  getOrCreatePlayerId
};
