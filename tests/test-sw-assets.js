import fs from 'fs';
import path from 'path';
import assert from 'assert';

async function runTests() {
    const swContent = fs.readFileSync(path.join(process.cwd(), 'static/sw.js'), 'utf8');
    const assetsMatch = swContent.match(/const ASSETS = \s*\[([\s\S]*?)\];/);
    if (!assetsMatch) {
        throw new Error("Could not find ASSETS array in sw.js");
    }
    const assets = assetsMatch[1]
        .split('\n')
        .map(line => line.trim().replace(/['",]/g, ''))
        .filter(line => line.length > 0 && line !== '/');
    for (const asset of assets) {
        const relPath = asset.replace(/^\/static\//, 'static/').replace(/^\//, '');
        const fullPath = path.join(process.cwd(), relPath);
        assert.ok(fs.existsSync(fullPath), `Asset ${asset} listed in sw.js does not exist on disk at ${relPath}`);
    }
    console.log("[PASS] Service Worker ASSETS verified on disk.");
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
