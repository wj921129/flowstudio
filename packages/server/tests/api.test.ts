import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('Diagrams REST API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildServer({ dbPath: ':memory:' });
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('completes full lifecycle: create, list/search, update, duplicate, and delete', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '风控审批图' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.id).toBeDefined();

    const dupRes = await app.inject({
      method: 'POST',
      url: `/api/diagrams/${created.id}/duplicate`,
    });
    expect(dupRes.statusCode).toBe(201);
    expect(dupRes.json().title).toBe('风控审批图 (副本)');

    const listRes = await app.inject({ method: 'GET', url: '/api/diagrams?q=副本' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().diagrams.length).toBe(1);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/diagrams/${created.id}`,
      payload: { title: '风控审批图 V2' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().title).toBe('风控审批图 V2');

    const delRes = await app.inject({ method: 'DELETE', url: `/api/diagrams/${created.id}` });
    expect(delRes.statusCode).toBe(204);
  });

  it('setNotFoundHandler 对 /api/*、/mcp/* 及非 GET 请求返回 404 JSON 而非 index.html', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstudio-webdist-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><body>SPA</body></html>', 'utf8');
    const built = await buildServer({ dbPath: ':memory:', webDistPath: tmpDir });
    try {
      for (const req of [
        { method: 'GET' as const, url: '/api/nonexistent' },
        { method: 'GET' as const, url: '/api' },
        { method: 'GET' as const, url: '/mcp/nonexistent' },
        { method: 'GET' as const, url: '/mcp' },
        { method: 'POST' as const, url: '/some-spa-route' },
      ]) {
        const res = await built.app.inject(req);
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: '接口不存在' });
      }

      const spaRes = await built.app.inject({ method: 'GET', url: '/diagram/123' });
      expect(spaRes.statusCode).toBe(200);
      expect(spaRes.body).toContain('SPA');

      const prefixRes = await built.app.inject({ method: 'GET', url: '/api-docs' });
      expect(prefixRes.statusCode).toBe(200);
      expect(prefixRes.body).toContain('SPA');
    } finally {
      await built.app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('校验 thumbnail 上限及列表分页/转义查询边界', async () => {
    const oversizedThumb = 'x'.repeat(512 * 1024 + 1);
    const badCreate = await app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '大图缩略图', thumbnail: oversizedThumb },
    });
    expect(badCreate.statusCode).toBe(400);

    const d1 = (await app.inject({ method: 'POST', url: '/api/diagrams', payload: { title: 'a_b 100%' } })).json();
    await app.inject({ method: 'POST', url: '/api/diagrams', payload: { title: 'axb 1000' } });
    await app.inject({ method: 'POST', url: '/api/diagrams', payload: { title: '第三张图' } });

    const badPatch = await app.inject({
      method: 'PATCH',
      url: `/api/diagrams/${d1.id}`,
      payload: { thumbnail: oversizedThumb },
    });
    expect(badPatch.statusCode).toBe(400);

    const searchRes = await app.inject({ method: 'GET', url: '/api/diagrams?q=' + encodeURIComponent('a_b 100%') });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json().diagrams.map((d: any) => d.title)).toEqual(['a_b 100%']);

    const pagedRes = await app.inject({ method: 'GET', url: '/api/diagrams?limit=2&offset=1' });
    expect(pagedRes.statusCode).toBe(200);
    expect(pagedRes.json().diagrams).toHaveLength(2);

    for (const badUrl of ['/api/diagrams?limit=-1', '/api/diagrams?limit=abc', '/api/diagrams?offset=-5']) {
      const res = await app.inject({ method: 'GET', url: badUrl });
      expect(res.statusCode).toBe(400);
    }
  });
});
