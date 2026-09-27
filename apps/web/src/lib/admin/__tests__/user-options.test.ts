/**
 * @jest-environment node
 */

import { fetchAllAdminUserOptions } from '../user-options';

function response(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('fetchAllAdminUserOptions', () => {
  it('follows API pagination and de-duplicates active owner candidates', async () => {
    const fetcher = jest.fn(async (url: string) => {
      const page = Number(new URL(url, 'http://local').searchParams.get('page'));
      return response({
        users:
          page === 1
            ? [
                { id: 'user-1', name: 'One', email: 'one@example.test' },
                { id: 'shared', name: 'Shared', email: 'shared@example.test' },
              ]
            : page === 2
              ? [
                  { id: 'user-2', name: 'Two', email: 'two@example.test' },
                  { id: 'shared', name: 'Shared', email: 'shared@example.test' },
                ]
              : [{ id: 'user-3', name: null, email: 'three@example.test' }],
        pagination: { page, totalPages: 3 },
      });
    });

    await expect(fetchAllAdminUserOptions(fetcher)).resolves.toEqual([
      { id: 'user-1', name: 'One', email: 'one@example.test' },
      { id: 'shared', name: 'Shared', email: 'shared@example.test' },
      { id: 'user-2', name: 'Two', email: 'two@example.test' },
      { id: 'user-3', name: null, email: 'three@example.test' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toContain('status=active');
    expect(fetcher.mock.calls[0]?.[0]).toContain('limit=100');
  });

  it('fails closed on an HTTP or response-contract error', async () => {
    await expect(
      fetchAllAdminUserOptions(jest.fn().mockResolvedValue(response({}, false)))
    ).rejects.toThrow('admin_users_fetch_failed');
    await expect(
      fetchAllAdminUserOptions(jest.fn().mockResolvedValue(response({ users: [] })))
    ).rejects.toThrow('admin_users_response_invalid');
  });
});
