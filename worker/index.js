export { UpstreamDurableObject } from './upstream.js';
// Explicitly forward cancellation: a Durable Object subrequest does not inherit stream cancellation.
async function searchResponse(request, stub) {
  const supplied = request.headers.get('X-Sitserve-Search-Id');
  const id = validID(supplied) ? supplied : crypto.randomUUID(), headers = new Headers(request.headers);
  headers.set('X-Sitserve-Search-Id', id);
  const upstream = await stub.fetch(new Request(request, { headers }));
  if (!upstream.ok || !upstream.body) return upstream;
  const reader = upstream.body.getReader();
  let closed = false, cancelling;
  const cancel = () => cancelling ||= Promise.allSettled([
    stub.fetch(new Request('https://sitserve.internal/internal/cancel', { method: 'POST', headers: { 'X-Sitserve-Search-Id': id, 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || 'local' } })),
    reader.cancel(),
  ]);
  const abort = () => { void cancel(); };
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (closed) return;
        if (done) { closed = true; request.signal.removeEventListener('abort', abort); controller.close(); }
        else controller.enqueue(value);
      } catch (e) { if (!closed) { closed = true; controller.error(e); void cancel(); } }
    },
    cancel() { closed = true; request.signal.removeEventListener('abort', abort); return cancel(); },
  });
  return new Response(stream, { status: upstream.status, headers: upstream.headers });
}
const validID = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/photo/')) {
      if (url.pathname === '/api/cancel') {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
        if (!validID(url.searchParams.get('id'))) return Response.json({ message: 'Invalid search id' }, { status: 400 });
        const stub = env.UPSTREAM_GATE.get(env.UPSTREAM_GATE.idFromName('upstream'));
        return stub.fetch(new Request('https://sitserve.internal/internal/cancel', { method: 'POST', headers: {
          'X-Sitserve-Search-Id': url.searchParams.get('id'), 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || 'local',
        } }));
      }
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
      if (url.pathname.startsWith('/api/') && !['/api/search', '/api/debug'].includes(url.pathname)) return new Response('Not found', { status: 404 });
      if (url.pathname === '/api/debug' && env.UPSTREAM === 'live') return new Response('Not found', { status: 404 });
      const stub = env.UPSTREAM_GATE.get(env.UPSTREAM_GATE.idFromName('upstream'));
      return url.pathname === '/api/search' ? searchResponse(request, stub) : stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
