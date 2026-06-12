const CACHE_NAME = "modie-03e52928";
const ASSETS = [
    "/",
    "/static/index.html",
    "/static/css/styles.css",
    "/static/css/base.css",
    "/static/css/editor.css",
    "/static/css/components.css",
    "/static/css/modal.css",
    "/static/css/browser.css",
    "/static/css/header.css",
    "/static/js/app.js",
    "/static/js/api.js",
    "/static/js/api-browser.js",
    "/static/js/api-browser-ops.js",
    "/static/js/ui.js",
    "/static/js/ui-find.js",
    "/static/js/ui-outline.js",
    "/static/js/ui-replace.js",
    "/static/js/ui-diff.js",
    "/static/js/indexeddb-sync.js",
    "/static/js/markdown.js",
    "/static/js/utils.js",
    "/static/js/gestures.js",
    "/static/js/editor.js",
    "/static/js/contextmenu.js",
    "/static/js/tabs.js",
    "/static/js/watch.js",
    "/static/js/settings.js",
    "/static/js/lucide.min.js",
    "/static/css/git.css",
    "/static/js/api-git.js",
    "/static/js/git.js",
    "/static/icon_v1.png",
    "/static/js/api-client.js",
    "/static/js/undo.js",
    "/static/manifest.json"
];

self.addEventListener("install", (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const cacheBustRequests = ASSETS.map(url => new Request(url, { cache: "reload" }));
            return cache.addAll(cacheBustRequests);
        })
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        Promise.all([
            clients.claim(),
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.map((key) => {
                        if (key !== CACHE_NAME) {
                            return caches.delete(key);
                        }
                    })
                );
            })
        ])
    );
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (url.pathname.startsWith("/api/")) {
        e.respondWith(fetch(e.request));
        return;
    }
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            return cachedResponse || fetch(e.request);
        })
    );
});
