/**
 * @jest-environment node
 */

const redisPublishMock = jest.fn();
const ensureRedisConnectionMock = jest.fn();
const redisClient = {
  status: 'ready',
  publish: (...args: unknown[]) => redisPublishMock(...args),
};

jest.mock('@/lib/server/redis', () => ({
  createRedisSubscriber: jest.fn(),
  ensureRedisConnection: (...args: unknown[]) => ensureRedisConnectionMock(...args),
  getRedisClient: () => redisClient,
}));

describe('publishEventAwaitingFanOut', () => {
  let eventBus: typeof import('../events').eventBus;
  let publishEventAwaitingFanOut: typeof import('../events').publishEventAwaitingFanOut;

  beforeAll(async () => {
    ({ eventBus, publishEventAwaitingFanOut } = await import('../events'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ensureRedisConnectionMock.mockResolvedValue(redisClient);
  });

  it('delivers locally immediately but resolves only after Redis accepts the event', async () => {
    const received: Array<{ type: string }> = [];
    const unsubscribe = eventBus.subscribe((event) => received.push(event));
    let acceptRedis!: (subscriberCount: number) => void;
    redisPublishMock.mockReturnValue(
      new Promise<number>((resolve) => {
        acceptRedis = resolve;
      })
    );

    let settled = false;
    const delivery = publishEventAwaitingFanOut('issue.updated', 'user-1', {
      organizationId: 'org-1',
      projectId: 'project-1',
      issueId: 'issue-1',
    }).then(() => {
      settled = true;
    });

    expect(received).toHaveLength(1);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(ensureRedisConnectionMock).toHaveBeenCalledWith(redisClient);
    expect(redisPublishMock).toHaveBeenCalledTimes(1);

    acceptRedis(1);
    await delivery;
    unsubscribe();

    expect(settled).toBe(true);
  });

  it('rejects on Redis failure after preserving local bus delivery', async () => {
    const received: Array<{ type: string }> = [];
    const unsubscribe = eventBus.subscribe((event) => received.push(event));
    redisPublishMock.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      publishEventAwaitingFanOut('issue.commented', 'user-2', {
        organizationId: 'org-1',
        issueId: 'issue-2',
      })
    ).rejects.toThrow('redis unavailable');
    unsubscribe();

    expect(received).toHaveLength(1);
  });
});
