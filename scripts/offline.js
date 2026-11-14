import net from 'node:net';
import dns from 'node:dns';
const hosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '::']);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !hosts.has(host)) throw new Error(`Offline mode blocked connection: ${host}`);
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  if (!hosts.has(hostname)) {
    const callback = args.at(-1);
    const error = new Error(`Offline mode blocked DNS lookup: ${hostname}`);
    if (typeof callback === 'function') { queueMicrotask(() => callback(error)); return; }
    throw error;
  }
  return lookup.call(this, hostname, ...args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input?.url || String(input);
  if (!hosts.has(new URL(url).hostname)) throw new Error(`Offline test blocked fetch: ${url}`);
  const response = await originalFetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
    const target = new URL(response.headers.get('location'), url);
    if (!hosts.has(target.hostname)) throw new Error(`Offline test blocked redirect: ${target}`);
  }
  return response;
};
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH ||= '/tmp/sitserve-wrangler-logs/';

process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
