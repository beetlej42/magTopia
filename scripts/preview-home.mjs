import { createApp } from '../apps/server/app.js';
import { createMemoryRepository } from '../apps/server/memory-repository.js';
const config = { publicBaseUrl: 'http://127.0.0.1:4192', assetOutputRoot: '/tmp/magtopia-home-preview', assetProvider: 'fixture', capabilityTtlMinutes: 30, credentialTtlDays: 90 };
const repository = createMemoryRepository(config);
const app = await createApp({ repository, config });
await app.listen({ port: 4192, host: '127.0.0.1' });
console.log('Homepage preview: http://127.0.0.1:4192 (temporary in-memory cities)');
