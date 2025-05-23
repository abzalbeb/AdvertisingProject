const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

const CONFIG_FILE = path.join(__dirname, 'config.json');
const CACHE_FILE = path.join(__dirname, 'video_cache.json');
const CACHE_EXPIRY = 3600000;

app.use(cors());
app.use(express.json());

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Ошибка чтения config.json:', err);
  }
  return { defaultVideoUrl: '' };
}

function writeConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  } catch (err) {
    console.error('Ошибка записи config.json:', err);
  }
}
function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Ошибка чтения video_cache.json:', err);
  }
  return {};
}

function writeCacheEntry(videoUrl, iframeUrl) {
  try {
    const cache = readCache();
    cache[videoUrl] = {
      url: iframeUrl,
      timestamp: Date.now()
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Ошибка записи в video_cache.json:', err);
  }
}

async function parseVideoUrl(videoPageUrl) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const allowedTypes = ['document', 'iframe'];
      allowedTypes.includes(req.resourceType()) ? req.continue() : req.abort();
    });

    await page.goto(videoPageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    const iframeUrl = await page.$eval('iframe[src*="rutube"]', el => el.src);
    return iframeUrl;

  } catch (err) {
    console.error('Ошибка при получении iframe URL:', err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}


app.get('/current-url', async (req, res) => {
  const { defaultVideoUrl } = readConfig();

  if (!defaultVideoUrl) {
    return res.status(404).json({ error: 'URL по умолчанию не задан' });
  }

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp < CACHE_EXPIRY)) {
      iframeUrl = entry.url;
    } else {
      iframeUrl = await parseVideoUrl(defaultVideoUrl);
      writeCacheEntry(defaultVideoUrl, iframeUrl);
    }

    res.json({ iframeUrl });
  } catch (err) {
    res.status(500).json({ error: 'Не удалось получить iframe URL' });
  }
});

app.post('/update-url', (req, res) => {
  const { newUrl } = req.body;

  if (!newUrl || !newUrl.startsWith('https://yandex.ru/video/preview/')) {
    return res.status(400).json({ error: 'Неверный формат URL' });
  }

  try {
    const config = readConfig();
    config.defaultVideoUrl = newUrl;
    writeConfig(config);
    res.json({ message: 'URL обновлён', url: newUrl });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления URL' });
  }
});

app.get('/', async (req, res) => {
  const { defaultVideoUrl } = readConfig();

  if (!defaultVideoUrl) {
    return res.status(404).send('<h1>URL по умолчанию не задан</h1>');
  }

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp < CACHE_EXPIRY)) {
      iframeUrl = entry.url;
    } else {
      iframeUrl = await parseVideoUrl(defaultVideoUrl);
      writeCacheEntry(defaultVideoUrl, iframeUrl);
    }

    res.set('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Rutube iframe</title>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          iframe { border: none; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h3>Rutube iframe:</h3>
        <iframe src="${iframeUrl}" width="800" height="450" allowfullscreen></iframe>
        <p>Видео источник: <a href="${defaultVideoUrl}" target="_blank">${defaultVideoUrl}</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Ошибка: ${err.message}</h1>`);
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
