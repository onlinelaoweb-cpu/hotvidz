const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors()); // Allow GitHub Pages to call this API
app.use(express.json());

// ── IN-MEMORY VIDEO STORE ──
let videoCache = {
  trending: [],
  latest: [],
  lastUpdated: null
};

// ── SCRAPE XVIDEOS ──
async function scrapeXVideos(url = 'https://www.xvideos.com/') {
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

    // XVideos video cards
    $('div.thumb-block, div.mozaique .thumb').each((i, el) => {
      try {
        const link = $(el).find('a').first().attr('href') || '';
        const title = $(el).find('p.title a, .title').first().text().trim();
        const duration = $(el).find('span.duration').first().text().trim();
        const views = $(el).find('span.nb-views').first().text().trim();
        const thumb = $(el).find('img').first().attr('data-src') ||
                      $(el).find('img').first().attr('src') || '';

        // Extract video ID from URL
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
          url: `https://www.xvideos.com${link}`
        });
      } catch(e) {}
    });

    return videos.filter(v => v.id);
  } catch (err) {
    console.error('Scrape error:', err.message);
    return [];
  }
}

// ── FETCH & CACHE VIDEOS ──
async function refreshVideos() {
  console.log('🔄 Refreshing video cache...');

  try {
    // Fetch from multiple pages
    const [trending, latest, milf, amateur] = await Promise.all([
      scrapeXVideos('https://www.xvideos.com/?k=hd&sort=relevance'),
      scrapeXVideos('https://www.xvideos.com/new'),
      scrapeXVideos('https://www.xvideos.com/?k=milf'),
      scrapeXVideos('https://www.xvideos.com/?k=amateur'),
    ]);

    // Dedupe by ID
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

    console.log(`✅ Cached ${unique.length} videos (${videoCache.trending.length} trending, ${videoCache.latest.length} latest)`);
  } catch (err) {
    console.error('Refresh error:', err.message);
  }
}

// ── FALLBACK VIDEOS (if scrape fails) ──
const FALLBACK_VIDEOS = [
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
  { id: 'oodpeftfefd', title: 'Sexy Nurse Fantasy Role Play', duration: '35 min', views: '980K', site: 'xvideos' },
  { id: 'oohtftb965d', title: 'Passionate Morning Quickie', duration: '18 min', views: '340K', site: 'xvideos' },
  { id: 'ucpebukc1fa', title: 'Brunette Wife Home Session', duration: '22 min', views: '420K', site: 'xvideos' },
  { id: 'opkphmcef1f', title: 'Asian Beauty Bedroom Scene', duration: '38 min', views: '1.1K', site: 'xvideos' },
  { id: 'opkdeuud128', title: 'Latina Teen First Time POV', duration: '14 min', views: '780K', site: 'xvideos' },
].map(v => ({
  ...v,
  thumb: `https://cdn77-pic.xvideos-cdn.com/videos/thumbs169poster/${v.id}/main.jpg`,
  src: v.id,
}));

// ── ROUTES ──

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    name: 'HotVidz API',
    lastUpdated: videoCache.lastUpdated,
    totalVideos: videoCache.trending.length + videoCache.latest.length
  });
});

// Get all videos
app.get('/api/videos', (req, res) => {
  const trending = videoCache.trending.length > 0 ? videoCache.trending : FALLBACK_VIDEOS.slice(0, 10);
  const latest   = videoCache.latest.length > 0   ? videoCache.latest   : FALLBACK_VIDEOS.slice(10);

  res.json({
    success: true,
    lastUpdated: videoCache.lastUpdated,
    trending,
    latest
  });
});

// Get trending only
app.get('/api/videos/trending', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const videos = videoCache.trending.length > 0 ? videoCache.trending : FALLBACK_VIDEOS;
  res.json({ success: true, videos: videos.slice(0, limit) });
});

// Get latest only
app.get('/api/videos/latest', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const videos = videoCache.latest.length > 0 ? videoCache.latest : FALLBACK_VIDEOS;
  res.json({ success: true, videos: videos.slice(0, limit) });
});

// Manual refresh (for testing)
app.post('/api/refresh', async (req, res) => {
  await refreshVideos();
  res.json({ success: true, message: 'Cache refreshed', lastUpdated: videoCache.lastUpdated });
});

// ── CRON JOB — refresh every 6 hours ──
cron.schedule('0 */6 * * *', () => {
  console.log('⏰ Cron: refreshing videos...');
  refreshVideos();
});

// ── START ──
app.listen(PORT, async () => {
  console.log(`🚀 HotVidz API running on port ${PORT}`);
  // Fetch on startup
  await refreshVideos();
});
