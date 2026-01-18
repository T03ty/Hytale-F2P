const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function downloadFile(url, dest, progressCallback) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://launcher.hytale.com/'
    }
  });

  const totalSize = parseInt(response.headers['content-length'], 10);
  let downloaded = 0;
  const startTime = Date.now();

  const writer = fs.createWriteStream(dest);

  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (progressCallback && totalSize > 0) {
      const percent = Math.min(100, Math.max(0, (downloaded / totalSize) * 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? downloaded / elapsed : 0;
      progressCallback(null, percent, speed, downloaded, totalSize);
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

function findHomePageUIPath(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isFile() && item.name === 'HomePage.ui') {
          return path.join(dir, item.name);
        } else if (item.isDirectory()) {
          const found = searchDirectory(path.join(dir, item.name));
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  return searchDirectory(gameLatest);
}

function findLogoPath(gameLatest) {
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isFile() && item.name === 'Logo@2x.png') {
          return path.join(dir, item.name);
        } else if (item.isDirectory()) {
          const found = searchDirectory(path.join(dir, item.name));
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
    }
    
    return null;
  }
  
  if (!fs.existsSync(gameLatest)) {
    return null;
  }
  
  return searchDirectory(gameLatest);
}

module.exports = {
  downloadFile,
  findHomePageUIPath,
  findLogoPath
};
