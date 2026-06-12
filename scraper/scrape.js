/**
 * GSPNS Novi Sad Bus Data Scraper
 * 
 * Scrapes bus route data from gspns.co.rs:
 * - Route list with IDs, names, colors from /mreza
 * - Route polylines from /mreza-get-linija-tacke
 * - Bus stops from /mreza-get-stajalista-tacke
 * - Schedules from /red-voznje/ispis-polazaka
 * 
 * Outputs: ../data/routes.json, ../data/schedules.json
 */

import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const BASE_URL = 'http://www.gspns.co.rs';
const DELAY_MS = 300; // delay between requests to be respectful

// Schedule valid-from date — auto-detected from GSPNS
let VAZIOD = null;

async function detectVaziod() {
  console.log('📆 Detecting current schedule date...');
  const html = await fetchText(`${BASE_URL}/red-voznje/gradski`);
  if (!html) {
    console.error('  ⚠ Could not fetch schedule page, using fallback date');
    return '2026-05-01';
  }
  const $ = cheerio.load(html);
  // Get all <option> values from the vaziod select
  const options = [];
  $('#vaziod option').each((_, el) => {
    const val = $(el).attr('value');
    if (val) options.push(val);
  });
  if (options.length === 0) {
    console.error('  ⚠ No vaziod options found, using fallback date');
    return '2026-05-01';
  }
  // Pick the latest (last) date
  options.sort();
  const latest = options[options.length - 1];
  console.log(`  Found ${options.length} schedule date(s), using: ${latest}`);
  return latest;
}

// Schedule line parameters (from GSPNS schedule page)
// Format: { param: URL parameter, key: our schedule key }
const SCHEDULE_LINES = [
  { param: '1*', key: '1' },
  { param: '2.', key: '2' },
  { param: '3.', key: '3' },
  { param: '3A.', key: '3A' },
  { param: '3B.', key: '3B' },
  { param: '4*', key: '4' },
  { param: '5', key: '5' },
  { param: '6', key: '6' },
  { param: '6A', key: '6A' },
  { param: '7A.', key: '7A' },
  { param: '7B.', key: '7B' },
  { param: '8', key: '8' },
  { param: '9.', key: '9' },
  { param: '10', key: '10' },
  { param: '11A.', key: '11A' },
  { param: '11B.', key: '11B' },
  { param: '12.', key: '12' },
  { param: '13', key: '13' },
  { param: '14', key: '14' },
  { param: '15', key: '15' },
  { param: '16.', key: '16' },
  { param: '17*', key: '17' },
  { param: '18A', key: '18A' },
  { param: '18B', key: '18B' },
  { param: '19.', key: '19' },
  { param: '20', key: '20' },
];

// Mapping from map route name → schedule key
// Hardcoded because the naming convention is irregular
const ROUTE_TO_SCHEDULE = {
  '1A': '1', '1B': '1',
  '1GLA': '1', '1GLB': '1',
  '1JA': '1', '1JB': '1',
  '2A': '2', '2B': '2',
  '3A': '3', '3B': '3',
  '3AA': '3A', '3AB': '3A',
  '3BA': '3B', '3BB': '3B',
  '4A': '4', '4B': '4',
  '5A': '5', '5B': '5',
  '5NA': '5', '5NB': '5',
  '6A': '6', '6B': '6',
  '6AA': '6A', '6AB': '6A',
  '6DA': '6', '6DB': '6',
  '6ĐB': '6',
  '7A': '7A', '7B': '7B',
  '8A': '8', '8B': '8',
  '9A': '9', '9B': '9',
  '9AA': '9', '9AB': '9',
  '10ALA': '10', '10ALB': '10', '10ALMB': '10',
  '10APTA': '10', '10APTB': '10',
  '10MALA': '10', '10ZKRA': '10',
  '11A': '11A', '11B': '11B',
  '11ĐA': '11A', '11ĐB': '11B',
  '12A': '12', '12B': '12',
  '13A': '13', '13B': '13',
  '13UĐA': '13',
  '14A': '14', '14B': '14',
  '14SA': '14', '14SB': '14',
  '14ĐA': '14', '14ĐB': '14',
  '15APTA': '15', '15APTB': '15',
  '15KNB': '15', '15NKA': '15',
  '15NPA': '15', '15NPB': '15',
  '16A': '16', '16B': '16',
  '17A': '17', '17B': '17',
  '18A': '18A', '18B': '18B',
  '19A': '19', '19B': '19',
  '20A': '20', '20B': '20',
};

const DAY_TYPES = ['R', 'S', 'N']; // Radni, Subota, Nedelja

// ─── Helpers ───────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url) {
  console.log(`  → ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  ⚠ HTTP ${res.status} for ${url}`);
    return null;
  }
  return res.text();
}

// ─── Step 1: Parse routes from /mreza ──────────────────────

async function parseRoutes() {
  console.log('\n📌 Step 1: Parsing routes from /mreza...');
  const html = await fetchText(`${BASE_URL}/mreza`);
  const $ = cheerio.load(html);

  // Extract colors from JavaScript
  const colors = {};
  const scriptContent = $('script').text();
  const colorRegex = /boje\[(\d+)\]\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = colorRegex.exec(scriptContent)) !== null) {
    colors[match[1]] = match[2].trim();
  }
  console.log(`  Found ${Object.keys(colors).length} color mappings`);

  // Extract city (grad) routes from button list
  const routes = [];
  $('a.button-linija.grad').each((_, el) => {
    const $el = $(el);
    const id = parseInt($el.attr('id'));
    const name = $el.text().trim();
    const title = $el.attr('title') || '';
    const color = colors[id] || '#888888';

    routes.push({
      id,
      name,
      title,
      color,
      scheduleGroup: ROUTE_TO_SCHEDULE[name] || null,
      polyline: [],
      stops: [],
    });
  });

  console.log(`  Found ${routes.length} city routes`);
  return routes;
}

// ─── Step 2: Fetch coordinates for each route ──────────────

async function fetchPolyline(routeId) {
  const text = await fetchText(`${BASE_URL}/mreza-get-linija-tacke?linija=${routeId}`);
  if (!text) return [];
  try {
    // Response is JSON array of "lat, lng" strings
    const trimmed = text.trim();
    const points = JSON.parse(trimmed);
    return points
      .map(p => {
        const cleaned = p.replace(/[\r\n]/g, '').trim();
        if (!cleaned) return null;
        const parts = cleaned.split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return [parts[0], parts[1]]; // [lat, lng]
        }
        return null;
      })
      .filter(Boolean);
  } catch (e) {
    console.error(`  ⚠ Failed to parse polyline for route ${routeId}: ${e.message}`);
    return [];
  }
}

// ─── Step 3: Fetch stops for each route ────────────────────

async function fetchStops(routeId) {
  const text = await fetchText(`${BASE_URL}/mreza-get-stajalista-tacke?linija=${routeId}`);
  if (!text) return [];
  try {
    const trimmed = text.trim();
    const items = JSON.parse(trimmed);
    const seen = new Set();
    const stops = [];

    for (const item of items) {
      // Format: "[lines]|lng|lat|name|photo|zone"
      const parts = item.split('|');
      if (parts.length < 6) continue;

      const linesStr = parts[0];
      const lng = parseFloat(parts[1]);
      const lat = parseFloat(parts[2]);
      const name = parts[3] || '';
      const photo = parts[4] || '';
      const zone = parts[5] || '';

      if (isNaN(lat) || isNaN(lng)) continue;

      // Deduplicate by name+lat+lng
      const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Parse line names from brackets
      const lineMatches = linesStr.match(/\[([^\]]+)\]/g);
      const lines = lineMatches ? lineMatches.map(m => m.slice(1, -1)) : [];

      stops.push({
        name: decodeUnicode(name),
        lat,
        lng,
        zone,
        photo: photo || null,
        lines,
      });
    }

    return stops;
  } catch (e) {
    console.error(`  ⚠ Failed to parse stops for route ${routeId}: ${e.message}`);
    return [];
  }
}

function decodeUnicode(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

// ─── Step 4: Parse schedules ───────────────────────────────

async function parseSchedule(lineParam, dayType) {
  const url = `${BASE_URL}/red-voznje/ispis-polazaka?rv=rvg&vaziod=${VAZIOD}&dan=${dayType}&linija%5B%5D=${encodeURIComponent(lineParam)}`;
  const html = await fetchText(url);
  if (!html) return { title: '', dirA: { name: '', departures: [] }, dirB: { name: '', departures: [] }, legend: null };
  const $ = cheerio.load(html);

  // Parse title
  const titleEl = $('.table-title');
  const title = titleEl.text().replace(/^[\s\S]*?:\s*/, '').trim();

  // Parse direction names from <th> tags
  const ths = $('th');
  let dirAName = '', dirBName = '';
  ths.each((i, th) => {
    const text = $(th).text().trim();
    const dirMatch = text.match(/(?:Смер|Smer)\s*([AB]):\s*(.*)/i);
    if (dirMatch) {
      if (dirMatch[1] === 'A') dirAName = dirMatch[2].trim();
      if (dirMatch[1] === 'B') dirBName = dirMatch[2].trim();
    }
  });

  // Parse departure times from <td> cells
  const tds = $('td[valign="top"]');
  const dirA = parseDepartures($, tds.eq(0));
  const dirB = tds.length > 1 ? parseDepartures($, tds.eq(1)) : [];

  // Parse legend from footer
  const footer = $('.tabelapolascifooter').text().trim();
  const legend = footer || null;

  return {
    title,
    dirA: { name: dirAName, departures: dirA },
    dirB: { name: dirBName, departures: dirB },
    legend,
  };
}

function parseDepartures($, $td) {
  if (!$td || $td.length === 0) return [];

  const departures = [];
  let currentHour = null;

  // Walk through direct children of the TD
  $td.contents().each((_, node) => {
    if (node.type === 'tag') {
      const $node = $(node);
      if (node.name === 'b') {
        // Hour marker (direct child <b>)
        const text = $node.text().trim();
        const h = parseInt(text);
        if (!isNaN(h) && text.length <= 2) {
          currentHour = h;
        }
      } else if (node.name === 'sup' && currentHour !== null) {
        // Minute entry
        const span = $node.find('span');
        const spanText = span.text().trim();
        const minuteMatch = spanText.match(/^(\d{2})(.*)/);
        if (minuteMatch) {
          const m = parseInt(minuteMatch[1]);
          const note = minuteMatch[2].trim() || null;
          const isLowFloor = span.hasClass('niskopodni-rampa');
          departures.push({
            h: currentHour,
            m,
            ...(note && { note }),
            ...(isLowFloor && { lowFloor: true }),
          });
        }
      }
    }
  });

  return departures;
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log('🚌 NS Bus Scraper — Starting...\n');

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Auto-detect schedule date
  VAZIOD = await detectVaziod();
  await sleep(DELAY_MS);

  // Step 1: Parse route list
  const routes = await parseRoutes();
  await sleep(DELAY_MS);

  // Step 2 & 3: Fetch coordinates and stops for each route
  console.log('\n📍 Step 2-3: Fetching coordinates and stops...');
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    console.log(`  [${i + 1}/${routes.length}] Route ${route.name} (id=${route.id})`);

    route.polyline = await fetchPolyline(route.id);
    await sleep(DELAY_MS);

    route.stops = await fetchStops(route.id);
    await sleep(DELAY_MS);

    console.log(`    → ${route.polyline.length} points, ${route.stops.length} stops`);
  }

  // Save routes
  const routesPath = join(DATA_DIR, 'routes.json');
  writeFileSync(routesPath, JSON.stringify(routes, null, 2), 'utf-8');
  console.log(`\n💾 Saved routes to ${routesPath}`);

  // Step 4: Parse schedules
  console.log('\n📅 Step 4: Parsing schedules...');
  const schedules = {};

  for (const line of SCHEDULE_LINES) {
    console.log(`  Schedule line: ${line.key} (param: ${line.param})`);
    schedules[line.key] = {};

    for (const day of DAY_TYPES) {
      try {
        const data = await parseSchedule(line.param, day);
        schedules[line.key][day] = data;
        const countA = data.dirA.departures.length;
        const countB = data.dirB.departures.length;
        console.log(`    ${day}: ${countA} departures (A), ${countB} departures (B)`);
      } catch (e) {
        console.error(`    ⚠ Failed to parse schedule ${line.key}/${day}: ${e.message}`);
        schedules[line.key][day] = null;
      }
      await sleep(DELAY_MS);
    }
  }

  // Save schedules
  const schedulesPath = join(DATA_DIR, 'schedules.json');
  writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2), 'utf-8');
  console.log(`\n💾 Saved schedules to ${schedulesPath}`);

  // Save metadata
  const metadata = {
    lastUpdated: new Date().toISOString(),
    scheduleDate: VAZIOD,
    routeCount: routes.length,
    scheduleCount: Object.keys(schedules).length,
  };
  const metaPath = join(DATA_DIR, 'metadata.json');
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  console.log(`💾 Saved metadata to ${metaPath}`);

  // Summary
  console.log('\n✅ Done!');
  console.log(`  Routes: ${routes.length}`);
  console.log(`  Schedules: ${Object.keys(schedules).length} lines × ${DAY_TYPES.length} days`);
}

main().catch(e => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
