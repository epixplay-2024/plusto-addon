import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';
import { load } from 'cheerio';
import { Buffer } from 'buffer';
import http from 'http';
import axios from 'axios';
import { chromium } from 'playwright';

const manifest = {
  id: 'org.plusto.streams',
  version: '1.0.5',
  name: 'Plusto Streams',
  logo: 'https://images.dwncdn.net/images/t_app-icon-l/p/872d9fc6-5a4d-443c-bedc-998b58f8dc60/2816728541/31711_4-78462552-imgingest-6684619287276046061.png',
  description: 'Addon que busca y extrae streams desde PelisPlus.to usando búsqueda profunda y verificación de título original',
  resources: ['stream'],
  types: ['movie'],
  catalogs: [],
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async (args) => {
  const imdbId = args.id;
  let title = '';
  let originalTitle = '';

  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: {
        api_key: 'd8330fdb12100a33cd0c3480c9857deb',
        external_source: 'imdb_id',
      },
    });

    const movieResults = tmdbRes.data.movie_results;
    if (!movieResults || movieResults.length === 0) {
      console.warn(`⚠️ No se encontró en TMDB: ${imdbId}`);
      return { streams: [] };
    }

    title = movieResults[0].title;
    originalTitle = movieResults[0].original_title;
    console.log(`🎬 Título TMDB: ${title} / ${originalTitle}`);
  } catch (err) {
    console.error('❌ Error en TMDB:', err.message);
    return { streams: [] };
  }

  let foundUrl = null;
  try {
    const searchUrl = `https://ww3.pelisplus.to/search/${encodeURIComponent(originalTitle)}`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const html = await page.content();
    const $ = load(html);

    const cards = $('a.itemA[href*="/pelicula/"]');

    for (let i = 0; i < cards.length; i++) {
      const href = $(cards[i]).attr('href');
      const url = href.startsWith('http') ? href : 'https://ww3.pelisplus.to' + href;

      const detailPage = await browser.newPage();
      await detailPage.goto(url, { waitUntil: 'domcontentloaded' });
      await detailPage.waitForTimeout(1000);

      const detailHtml = await detailPage.content();
      const $$ = load(detailHtml);

      const slugText = $$('.slug').text().toLowerCase();

      if (slugText.includes(originalTitle.toLowerCase())) {
        foundUrl = url;
        console.log(`✅ URL confirmada por texto interno: ${url}`);
        await detailPage.close();
        break;
      }
      await detailPage.close();
    }

    await browser.close();
  } catch (err) {
    console.error('❌ Error durante búsqueda:', err.message);
    return { streams: [] };
  }

  if (!foundUrl) {
    console.warn('⚠️ No se encontró coincidencia de título en PelisPlus');
    return { streams: [] };
  }

  try {
    const res = await fetch(foundUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const $ = load(html);
    const streams = [];

    $('.player.main [data-server]').each((i, el) => {
      const server = $(el).attr('data-server');
      if (server) {
        const encoded = Buffer.from(server).toString('base64');
        const streamUrl = `https://ww3.pelisplus.to/player/${encoded}`;
        streams.push({
          name: 'PelisPlus',
          title: `Opción ${i + 1}`,
          url: streamUrl,
        });
      }
    });

    console.log(`🎥 Enlaces encontrados: ${streams.length}`);
    return { streams };
  } catch (err) {
    console.error('❌ Error al scrapear la película:', err.message);
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
const PORT = process.env.PORT || 7000;
http.createServer(serveHTTP(addonInterface)).listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Addon corriendo en: http://localhost:${PORT}/manifest.json`);
});

