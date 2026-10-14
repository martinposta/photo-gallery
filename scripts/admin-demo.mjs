// The admin on the demo gallery from `npm run demo` (cross-platform way to set GALLERY_DATA_ROOT).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GALLERY_DATA_ROOT ||= path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-data');
await import('../admin/server.mjs');
