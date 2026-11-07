import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
