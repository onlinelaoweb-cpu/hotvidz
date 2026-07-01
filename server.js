const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ── SERVE STATIC HTML FILES ──
app.use(express.static(path.join(__dirname, 'public')));

// ── IN-MEMORY VIDEO STORE ──
let videoCache = {
  trending: [],
  latest: [],
  lastUpdated: null
};

// ── SCRAPE XVIDEOS ──
async function scrapeXVideos(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const videos = [];

    $('div.thumb-block, div.mozaique .thumb').each((i, el) => {
      try {
        const link = $(el).find('a').first().attr('href') || '';
        const title = $(el).find('p.title a, .title').first().text().trim();
        const duration = $(el).find('span.duration').first().text().trim();
        const views = $(el).find('span.nb-views').first().text().trim();
        const thumb = $(el).find('img').first().attr('data-src') ||
                      $(el).find('img').first().attr('src') || '';

        const idMatch = link.match(/\/video\.?([a-z0-9]+)\//);
        if (!idMatch) return;
        const id = idMatch[1];
        if (!id || id.length < 4) return;

        videos.push({
          id,
          title: title || 'Untitled Video',
          duration: duration || '10 min',
          views: views || '0',
          thumb: thumb.startsWith('http') ? thumb :
                 `https://cdn77-pic.xvideos-cdn.com/videos/thumbs169poster/${id}/main.jpg`,
          src: id,
          site: 'xvideos',
        });
      } catch(e) {}
    });

    return videos.filter(v => v.id);
  } catch (err) {
    console.error('Scrape error:', err.message);
    return [];
  }
}

// ── REFRESH CACHE ──
async function refreshVideos() {
  console.log('🔄 Refreshing video cache...');
  try {
    const [trending, latest, milf, amateur] = await Promise.all([
      scrapeXVideos('https://www.xvideos.com/?k=hd&sort=relevance'),
      scrapeXVideos('https://www.xvideos.com/new'),
      scrapeXVideos('https://www.xvideos.com/?k=milf'),
      scrapeXVideos('https://www.xvideos.com/?k=amateur'),
    ]);

    const allVideos = [...trending, ...latest, ...milf, ...amateur];
    const seen = new Set();
    const unique = allVideos.filter(v => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });

    videoCache.trending = unique.slice(0, 20);
    videoCache.latest   = unique.slice(20, 40);
    videoCache.lastUpdated = new Date().toISOString();
    console.log(`✅ Cached ${unique.length} videos`);
  } catch (err) {
    console.error('Refresh error:', err.message);
  }
}

// ── FALLBACK VIDEOS ──
const FALLBACK = [
  { id: 'opilkli381f', title: 'Hot Amateur Couple Home Video', duration: '24 min', views: '2.9M', site: 'xvideos' },
  { id: 'ufthimo2cdc', title: 'MILF Seduces Young Stud', duration: '18 min', views: '1.2M', site: 'xvideos' },
  { id: 'oobopeve53b', title: 'Petite Blonde Gets Drilled', duration: '15 min', views: '890K', site: 'xvideos' },
  { id: 'kalkeafaa2b', title: 'Busty Brunette Office Fantasy', duration: '33 min', views: '450K', site: 'xvideos' },
  { id: 'opiboek0be3', title: 'Asian Babe Surprise Massage', duration: '49 min', views: '3.1M', site: 'xvideos' },
  { id: 'oofbtdpbadc', title: 'Curvy Latina Amazing Body', duration: '12 min', views: '670K', site: 'xvideos' },
  { id: 'ookabft1f3f', title: 'Cute Teen Blonde At Gym', duration: '19 min', views: '1.0M', site: 'xvideos' },
  { id: 'okcuhom2b47', title: 'Redhead Slow Sensual Session', duration: '58 min', views: '1.2M', site: 'xvideos' },
  { id: 'uvvmobd43ae', title: 'Stepsis Caught In The Act', duration: '27 min', views: '5.6M', site: 'xvideos' },
  { id: 'kpkatam4ba0', title: 'MILF Next Door Seduces Neighbor', duration: '42 min', views: '2.1M', site: 'xvideos' },
].map(v => ({ ...v, thumb: `https://cdn77-pic.xvideos-cdn.com/videos/thumbs169poster/${v.id}/main.jpg`, src: v.id }));

// ── API ROUTES ──
app.get('/api/videos', (req, res) => {
  res.json({
    success: true,
    lastUpdated: videoCache.lastUpdated,
    trending: videoCache.trending.length > 0 ? videoCache.trending : FALLBACK,
    latest: videoCache.latest.length > 0 ? videoCache.latest : FALLBACK,
  });
});

app.get('/api/videos/trending', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ success: true, videos: (videoCache.trending.length > 0 ? videoCache.trending : FALLBACK).slice(0, limit) });
});

app.get('/api/videos/latest', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ success: true, videos: (videoCache.latest.length > 0 ? videoCache.latest : FALLBACK).slice(0, limit) });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', name: 'HotVidz API', lastUpdated: videoCache.lastUpdated, totalVideos: videoCache.trending.length + videoCache.latest.length });
});

app.post('/api/refresh', async (req, res) => {
  await refreshVideos();
  res.json({ success: true, lastUpdated: videoCache.lastUpdated });
});

// ── THUMBNAIL PROXY ──
app.get('/thumb/:id', async (req, res) => {
  const { id } = req.params;
  const thumbUrl = `https://cdn77-pic.xvideos-cdn.com/videos/thumbs169poster/${id}/main.jpg`;
  try {
    const response = await axios.get(thumbUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Referer': 'https://www.xvideos.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch(err) {
    res.set('Content-Type', 'image/svg+xml');
    res.send('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1a1a1a"/><text x="160" y="95" text-anchor="middle" fill="#444" font-size="40">🎬</text></svg>');
  }
});

// ── CATCH ALL — serve index.html for any unknown route ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── CRON — refresh every 6 hours ──
cron.schedule('0 */6 * * *', refreshVideos);

// ── START ──
app.listen(PORT, async () => {
  console.log(`🚀 HotVidz running on port ${PORT}`);
  await refreshVideos();
});