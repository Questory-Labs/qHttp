import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, bench, describe } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';

const payload = { ok: true, items: [1, 2, 3] };
const postBody = { name: 'widget', qty: 2 };

let server: Server;
let baseUrl = '';
let sharedQHttp: QHttp;
let sharedQHttpPost: QHttp;
let cacheHitQHttp: QHttp;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/items') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(JSON.stringify(payload))),
      });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === 'POST' && req.url === '/items') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const response = { ok: true, received: body };
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  sharedQHttp = new QHttp({ baseUrl }).setUrl('/items');
  sharedQHttpPost = new QHttp({ baseUrl }).setUrl('/items').setBody(postBody);

  const cache = new MemoryCacheEngine();
  cacheHitQHttp = new QHttp({ baseUrl }).setUrl('/items').cache().cacheEngine(cache);
  await cacheHitQHttp.get();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /items — localhost round-trip', () => {
  bench('fetch (native)', async () => {
    const response = await fetch(`${baseUrl}/items`);
    await response.json();
  });

  bench('QHttp.get (reused client)', async () => {
    await sharedQHttp.get();
  });

  bench('QHttp.get (new client each call)', async () => {
    await new QHttp({ baseUrl }).setUrl('/items').get();
  });

  bench('QHttp.get (hooks + cache miss)', async () => {
    const cache = new MemoryCacheEngine();
    await new QHttp({ baseUrl })
      .setUrl('/items')
      .preRequest((ctx) => {
        ctx.headers.set('x-demo', '1');
      })
      .cache()
      .cacheEngine(cache)
      .get();
  });

  bench('QHttp.get (cache hit)', async () => {
    await cacheHitQHttp.get();
  });
});

describe('POST /items — localhost round-trip', () => {
  bench('fetch POST (native)', async () => {
    const response = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(postBody),
    });
    await response.json();
  });

  bench('QHttp.post (reused client)', async () => {
    await sharedQHttpPost.post();
  });

  bench('QHttp.post (new client each call)', async () => {
    await new QHttp({ baseUrl }).setUrl('/items').setBody(postBody).post();
  });
});
