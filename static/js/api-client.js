let errorListeners = [];

export function onRequestError(fn) {
    errorListeners.push(fn);
}

function triggerRequestError(err, path, body, opts) {
    errorListeners.forEach(fn => {
        try {
            fn(err, path, body, opts);
        } catch (e) {
            console.error(e);
        }
    });
}

class ApiError extends Error {
    constructor(message, code, status = null) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'ApiError';
    }
}

function getHeaders(extraHeaders = {}) {
    const token = localStorage.getItem('editor_token') || '';
    return {
        'X-Editor-Token': token,
        ...extraHeaders
    };
}

function handle401(ctx) {
    localStorage.removeItem('editor_token');
    if (ctx && typeof ctx.setStatus === 'function') {
        ctx.setStatus('error', 'Unauthorized');
    }
    const modal = document.querySelector('#authModal');
    if (modal) {
        modal.classList.add('active');
        const input = document.querySelector('#authTokenInput');
        if (input) input.focus();
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

async function requestWithRetry(method, path, body = null, opts = {}) {
    const ctx = opts.ctx;
    const timeout = opts.timeout || (method === 'POST' ? 30000 : 8000);
    // Automatic retries are disabled specifically for /api/content POST requests to prevent
    // false conflict (409) errors if the server successfully writes the file before timing out.
    // Other requests are allowed to retry on transient network drops.
    const isSaveContent = method === 'POST' && (path === '/api/content' || path.startsWith('/api/content?') || path.endsWith('/api/content'));
    const maxRetries = isSaveContent ? 0 : (opts.maxRetries ?? 2);
    
    let url = path;
    if (method === 'GET' && body) {
        const q = new URLSearchParams(body).toString();
        if (q) {
            url += (url.includes('?') ? '&' : '?') + q;
        }
    }
    
    const fetchOpts = {
        method,
        headers: getHeaders(opts.headers || {})
    };
    if (method === 'POST' && body) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(body);
    }
    
    let attempt = 0;
    while (true) {
        try {
            const res = await fetchWithTimeout(url, fetchOpts, timeout);
            if (res.status === 401) {
                handle401(ctx);
                throw new ApiError('Unauthorized', 'auth', 401);
            }
            if (res.status === 409) {
                throw new ApiError('Conflict', 'conflict', 409);
            }
            if (res.status >= 500) {
                throw new ApiError(`Server Error: ${res.status}`, 'server', res.status);
            }
            if (res.status >= 400) {
                throw new ApiError(`Client Error: ${res.status}`, 'client', res.status);
            }
            return await res.json();
        } catch (err) {
            let apiErr;
            if (err.name === 'AbortError') {
                apiErr = new ApiError('Request timeout', 'timeout');
            } else if (err instanceof ApiError) {
                apiErr = err;
            } else {
                apiErr = new ApiError(err.message || 'Network error', 'network');
            }
            
            if (attempt >= maxRetries && method === 'POST') {
                triggerRequestError(apiErr, path, body, opts);
            }
            
            if (attempt < maxRetries && (apiErr.code === 'network' || apiErr.code === 'timeout')) {
                attempt++;
                const delay = attempt === 1 ? 1000 : 3000;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw apiErr;
        }
    }
}

export function apiGet(path, params = {}, opts = {}) {
    return requestWithRetry('GET', path, params, opts);
}

export function apiPost(path, body = {}, opts = {}) {
    return requestWithRetry('POST', path, body, opts);
}
