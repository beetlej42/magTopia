import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../apps/server/app.js';
import { createMemoryRepository } from '../apps/server/memory-repository.js';

test('public showcase serves its assets without exposing development surfaces', async () => {
  const config = { publicBaseUrl: 'https://city.example', assetOutputRoot: '/tmp/magtopia-home-test' };
  const app = await createApp({ repository: createMemoryRepository(config), config });
  try {
    const home = await app.inject('/');
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /https:\/\/city.example\/brand\/city-vision.jpg/);
    assert.match(home.body, /href="\/play"/);
    assert.doesNotMatch(home.body, /href="\/studio|src="\/src\/main.js/);
    for (const [file, type] of [['logo.svg', 'image/svg+xml'], ['home.css', 'text/css'], ['home.js', 'text/javascript'], ['city-stage-0.jpg', 'image/jpeg'], ['city-stage-1.jpg', 'image/jpeg'], ['city-stage-2.jpg', 'image/jpeg'], ['city-vision.jpg', 'image/jpeg'], ['city-day.jpg', 'image/jpeg'], ['city-night.jpg', 'image/jpeg']]) {
      const response = await app.inject(`/brand/${file}`);
      assert.equal(response.statusCode, 200, file);
      assert.ok(response.headers['content-type'].startsWith(type), file);
      assert.ok(response.rawPayload.length > 100, file);
    }
    assert.equal((await app.inject('/brand/app.js')).statusCode, 404);
    assert.equal((await app.inject('/brand/constructor')).statusCode, 404);
    assert.equal((await app.inject('/play')).statusCode, 200);
    assert.equal((await app.inject('/agent')).statusCode, 200);
    assert.equal((await app.inject('/dashboard')).statusCode, 200);
  } finally { await app.close(); }
});
