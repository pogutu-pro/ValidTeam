jest.mock('ioredis', () => {
  const subscriber = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  };
  const commandClient = {
    on: jest.fn(),
    duplicate: jest.fn(() => subscriber),
  };

  return {
    __esModule: true,
    default: jest.fn(() => commandClient),
    mockCommandClient: commandClient,
    mockSubscriber: subscriber,
  };
});

jest.mock('@/lib/logger', () => {
  const warn = jest.fn();
  return {
    childLogger: () => ({ warn }),
    mockWarn: warn,
  };
});

import { createRedisSubscriber, getRedisClient } from '../redis';

const redisMock = jest.requireMock('ioredis') as {
  mockCommandClient: {
    on: jest.Mock;
    duplicate: jest.Mock;
  };
  mockSubscriber: {
    on: jest.Mock;
    connect: jest.Mock;
  };
};
const loggerMock = jest.requireMock('@/lib/logger') as { mockWarn: jest.Mock };

describe('Redis connection logging', () => {
  beforeEach(() => {
    delete global.__tasknebulaRedis__;
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://redis.test:6379';
  });

  afterAll(() => {
    delete process.env.REDIS_URL;
    delete global.__tasknebulaRedis__;
  });

  it('handles command-client errors through the structured logger', () => {
    getRedisClient();

    expect(redisMock.mockCommandClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    const onError = redisMock.mockCommandClient.on.mock.calls[0]?.[1] as (error: Error) => void;
    const error = new Error('connection refused');
    onError(error);

    expect(loggerMock.mockWarn).toHaveBeenCalledWith(
      { err: error, role: 'command' },
      'redis connection error'
    );
  });

  it('handles subscriber errors before connecting', async () => {
    const subscriber = await createRedisSubscriber();

    expect(subscriber).toBe(redisMock.mockSubscriber);
    expect(redisMock.mockSubscriber.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(redisMock.mockSubscriber.connect).toHaveBeenCalledTimes(1);
  });
});
