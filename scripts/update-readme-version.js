import fs from 'fs';
import path from 'path';
import url from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const readmePath = path.join(rootDir, 'README.md');

const version = pkg.version;
const cdnUrl = `https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v${version}/dist/plugins/trouble-plugin.js`;

const content = fs.readFileSync(readmePath, 'utf8');

const updated = content
    // Update heading link text
    .replace(/\[CDN Link \(v[\d.]+\)\]/g, `[CDN Link (v${version})]`)
    // Update raw URL occurrences
    .replace(
        /https:\/\/cdn\.jsdelivr\.net\/gh\/customjack\/board_game_plugin_trouble@v[\d.]+\/dist\/plugins\/trouble-plugin\.js/g,
        cdnUrl
    );

if (updated !== content) {
    fs.writeFileSync(readmePath, updated, 'utf8');
    console.log(`[update-readme-version] README updated to v${version}`);
} else {
    console.log('[update-readme-version] README already up to date');
}
