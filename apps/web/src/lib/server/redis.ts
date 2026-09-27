import Redis from 'ioredis';
import { childLogger } from '@/lib/logger';

const log = childLogger('server/redis');

declare global {
  // eslint-disable-next-line no-var -- required for global augmentation
  var __tasknebulaRedis__: Redis | undefined;
}

function getRedisUrl() {
  return process.env.REDIS_URL || null;
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

function attachRedisErrorLogger(client: Redis, role: 'command' | 'subscriber') {
  client.on('error', (error) => {
    log.warn({ err: error, role }, 'redis connection error');
  });

  return client;
}

export function getRedisClient() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (!global.__tasknebulaRedis__) {
    global.__tasknebulaRedis__ = attachRedisErrorLogger(
      new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        enableReadyCheck: false,
      }),
      'command'
    );
  }

  return global.__tasknebulaRedis__;
}

export async function createRedisSubscriber() {
  const baseClient = getRedisClient();
  if (!baseClient) {
    return null;
  }

  const subscriber = attachRedisErrorLogger(
    baseClient.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
    }),
    'subscriber'
  );
  await subscriber.connect();
  return subscriber;
}

export async function ensureRedisConnection(client: Redis | null) {
  if (!client) {
    return null;
  }

  if (client.status === 'wait') {
    await client.connect();
  }

  return client;
}
