const axios = require('axios');

async function getLatestClientVersion() {
  try {
    console.log('Fetching latest client version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/version_client', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Latest client version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid API response, falling back to default version');
      return '4.pwr';
    }
  } catch (error) {
    console.error('Error fetching client version:', error.message);
    console.log('Warning: API unavailable, falling back to default version');
    return '4.pwr';
  }
}

async function getInstalledClientVersion() {
  try {
    console.log('Fetching installed client version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/clientCheck', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.client_version) {
      const version = response.data.client_version;
      console.log(`Installed client version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid clientCheck API response');
      return null;
    }
  } catch (error) {
    console.error('Error fetching installed client version:', error.message);
    console.log('Warning: clientCheck API unavailable');
    return null;
  }
}

async function getMultiClientVersion() {
  try {
    console.log('Fetching Multiplayer version from API...');
    const response = await axios.get('http://3.10.208.30:3002/api/multi', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Hytale-F2P-Launcher'
      }
    });

    if (response.data && response.data.multi_version) {
      const version = response.data.multi_version;
      console.log(`Multiplayer version: ${version}`);
      return version;
    } else {
      console.log('Warning: Invalid multi API response');
      return null;
    }
  } catch (error) {
    console.error('Error fetching Multiplayer version:', error.message);
    console.log('Multiplayer not available');
    return null;
  }
}

module.exports = {
  getLatestClientVersion,
  getInstalledClientVersion,
  getMultiClientVersion
};
