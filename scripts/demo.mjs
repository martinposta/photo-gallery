// Fills a separate demo gallery with generated gradient "photos", so the admin and the site can be
// tried without any real pictures. Never touches your own gallery: it writes to ./demo-data
// (or GALLERY_DATA_ROOT if you set one explicitly).
//
//   npm run demo                 create the demo gallery
//   npm run admin:demo           open the admin on it
//
// Optional, for publishing the demo (the project's live demo is built this way):
//   DEMO_SITE_URL   public address of the demo, for link previews (e.g. https://<you>.github.io/<repo>/)
//   DEMO_REPO_URL   link to the source code, shown in the demo's profile

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GALLERY_DATA_ROOT ||= path.join(ROOT, 'demo-data');
const DATA = path.resolve(process.env.GALLERY_DATA_ROOT);
if (DATA === ROOT) throw new Error('Refusing to put demo photos into the project folder itself; set GALLERY_DATA_ROOT to an empty folder.');

const G = await import('../lib/gallery.mjs');
const { loadData } = await import('../lib/store.mjs');
const { buildSite } = await import('../lib/build.mjs');

if ((await loadData()).photos.length) {
  console.log(`\n  ${DATA} already has photos. Delete that folder to start over.\n`);
  process.exit(0);
}

// Gradients rendered from an SVG by sharp, no assets needed. A soft "sun" in some of them so the
// grid is not just flat diagonals.
const gradient = ([a, b, sun], [w, h]) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>`
  + `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  + `<radialGradient id="s" cx="${sun ? sun[0] : 0.5}" cy="${sun ? sun[1] : 0.5}" r="0.35"><stop offset="0" stop-color="#fff" stop-opacity="${sun ? 0.55 : 0}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
  + `</defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#s)"/></svg>`))
  .jpeg({ quality: 90 }).toBuffer();

const SIZES = { wide: [3200, 1800], land: [3000, 2000], port: [2000, 3000], square: [2600, 2600] };

// Collections in two groups plus one on its own; one starred, so every part of the site shows up.
const COLLECTIONS = [
  { key: 'dawn', title: 'Dawn', group: 'Times of day', description: 'Pinks and oranges before the day starts.', starred: true },
  { key: 'dusk', title: 'Dusk', group: 'Times of day', description: 'Purples, blues and the last warm light.' },
  { key: 'sea', title: 'Sea', group: 'Places', description: 'Everything blue and green.' },
  { key: 'forest', title: 'Forest', group: 'Places', description: 'Greens, from moss to pine.' },
  { key: 'mono', title: 'Monochrome', group: '', description: 'One colour at a time.' },
];

const PHOTOS = [
  ['dawn', 'First light', 'Harbour', ['#ff9a8b', '#ffd3a5', [0.7, 0.3]], 'wide', 'The moment the sky turns from grey to pink.'],
  ['dawn', 'Coral sky', 'Harbour', ['#f6d365', '#fda085', [0.3, 0.25]], 'land', ''],
  ['dawn', 'Peach', 'Old town', ['#ffecd2', '#fcb69f'], 'port', ''],
  ['dawn', 'Early', 'Hills', ['#fbc2eb', '#a6c1ee', [0.5, 0.2]], 'square', 'Shot from the top of the hill, half an hour before sunrise.'],
  ['dusk', 'Violet hour', 'Pier', ['#614385', '#516395', [0.8, 0.7]], 'land', ''],
  ['dusk', 'Afterglow', 'Pier', ['#e96443', '#904e95', [0.2, 0.8]], 'wide', 'Ten minutes after sunset, the colour was still everywhere.'],
  ['dusk', 'Blue hour', 'Rooftops', ['#141e30', '#243b55'], 'port', ''],
  ['dusk', 'Ember', 'Rooftops', ['#cc2b5e', '#753a88'], 'land', ''],
  ['sea', 'Shallow water', 'Lagoon', ['#2193b0', '#6dd5ed', [0.6, 0.4]], 'wide', 'Clear enough to see the sand.'],
  ['sea', 'Open sea', 'Coast', ['#0f2027', '#2c5364'], 'land', ''],
  ['sea', 'Lagoon', 'Lagoon', ['#06beb6', '#48b1bf'], 'port', ''],
  ['sea', 'Spray', 'Coast', ['#89f7fe', '#66a6ff', [0.4, 0.6]], 'square', ''],
  ['forest', 'Moss', 'Valley', ['#56ab2f', '#a8e063'], 'land', 'After three days of rain.'],
  ['forest', 'Pines', 'Ridge', ['#134e5e', '#71b280'], 'port', ''],
  ['forest', 'Clearing', 'Valley', ['#1d976c', '#93f9b9', [0.5, 0.35]], 'wide', ''],
  ['forest', 'Fern', 'Ridge', ['#d4fc79', '#96e6a1'], 'land', ''],
  ['mono', 'Graphite', 'Studio', ['#232526', '#414345'], 'square', ''],
  ['mono', 'Paper', 'Studio', ['#e6dada', '#f5f7fa', [0.5, 0.5]], 'port', ''],
  ['mono', 'Ink', 'Studio', ['#000428', '#004e92'], 'land', ''],
  ['', 'Somewhere in between', '', ['#ee9ca7', '#ffdde1'], 'land', 'Not every photo needs a collection.'],
  ['', 'Unfiled', '', ['#de6262', '#ffb88c', [0.25, 0.3]], 'port', ''],
];

const repo = process.env.DEMO_REPO_URL || '';
await G.updateSettings({
  name: 'Demo Gallery',
  bio: 'A demo of this photo gallery. The "photos" are generated gradients: click around, open one, try the arrow keys.',
  copyright: '© Demo Gallery',
  links: repo ? [{ label: 'Source on GitHub', url: repo }] : [],
  siteUrl: process.env.DEMO_SITE_URL || '',
});

const ids = {};
for (const c of COLLECTIONS) {
  const made = await G.createCollection({ title: c.title, description: c.description, group: c.group });
  if (c.starred) await G.updateCollection(made.id, { starred: true });
  ids[c.key] = made.id;
}

for (const [i, [coll, title, place, colours, size, description]] of PHOTOS.entries()) {
  const { photo } = await G.addPhoto(await gradient(colours, SIZES[size]), `gradient-${String(i + 1).padStart(2, '0')}.jpg`, coll ? ids[coll] : '');
  // Spread over a year so sorting by date taken has something to sort.
  const day = new Date(Date.UTC(2025, 0, 1) + i * 17 * 864e5).toISOString().slice(0, 10);
  await G.updatePhoto(photo.id, { title, location: place, description, takenAt: `${day}T${String(6 + (i % 12)).padStart(2, '0')}:30:00` });
}
await G.publishDrafts();
const res = await buildSite();
console.log(`\n  Demo gallery ready in ${DATA}: ${res.photos} photos, ${res.pages} pages.`);
console.log('  Start the admin on it with:  npm run admin:demo\n');
