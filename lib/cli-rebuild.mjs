// `npm run rebuild` — regenerate docs/ pages and data.json from data/gallery.json
// (useful after editing site/ templates or gallery.json by hand).

import { buildSite } from './build.mjs';

const res = await buildSite();
console.log(`Done: ${res.photos} photos, ${res.pages} pages (version ${res.version}).`);
