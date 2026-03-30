/**
 * Shared fetch helper for production tests.
 * Handles HTTPS, SSL, redirects.
 */

const https = require('https');
const http = require('http');

/**
 * Fetch URL with optional SSL verification disabled (for ALB/internal certs).
 * Follows redirects.
 */
function fetch(url, options = {}, followRedirects = true, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      ...(isHttps ? { rejectUnauthorized: false } : {})
    };

    const req = client.request(requestOptions, (res) => {
      if (followRedirects && [301, 302, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (location) {
          const redirectUrl = location.startsWith('http') ? location : `${parsedUrl.protocol}//${parsedUrl.hostname}${location}`;
          return resolve(fetch(redirectUrl, options, followRedirects, maxRedirects - 1));
        }
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => Promise.resolve(JSON.parse(data || '{}')),
          text: () => Promise.resolve(data)
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(options.timeout || 15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = { fetch };
