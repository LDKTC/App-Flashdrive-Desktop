const fs = require('fs');
const path = require('path');

const APP_EXT = new Set(['.exe', '.lnk', '.bat', '.cmd', '.url', '.appimage', '.app']);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const SKIP_DIR = new Set(['node_modules', '$recycle.bin', 'system volume information']);
// ponytail: name heuristic to hide installer/helper exes; tune the list if real apps get hidden
const NOT_APP = /unins|setup|update|crash|helper|install/i;

// Find files under dir whose extension is in exts, going `depth` folders deep, at most `limit` results.
// A folder with a matching extension (macOS .app bundle) counts as one item.
function scan(dir, exts, depth, limit, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= limit) break;
    const p = path.join(dir, e.name);
    const match = exts.has(path.extname(e.name).toLowerCase());
    if (e.isDirectory() && !match) {
      if (depth > 0 && !e.name.startsWith('.') && !SKIP_DIR.has(e.name.toLowerCase())) scan(p, exts, depth - 1, limit, out);
    } else if (match && !(exts === APP_EXT && NOT_APP.test(e.name))) {
      out.push(p);
    }
  }
  return out;
}

module.exports = { scan, APP_EXT, IMG_EXT };
