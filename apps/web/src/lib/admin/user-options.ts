export interface AdminUserOption {
  id: string;
  name: string | null;
  email: string;
}

type AdminUsersPage = {
  users: AdminUserOption[];
  pagination: { page: number; totalPages: number };
};

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

const PAGE_SIZE = 100;
const PAGE_BATCH_SIZE = 8;

function isAdminUsersPage(value: unknown): value is AdminUsersPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<AdminUsersPage>;
  return (
    Array.isArray(page.users) &&
    Boolean(page.pagination) &&
    Number.isInteger(page.pagination?.page) &&
    Number.isInteger(page.pagination?.totalPages) &&
    page.pagination!.page >= 1 &&
    page.pagination!.totalPages >= 0 &&
    page.users.every(
      (user) =>
        Boolean(user) &&
        typeof user.id === 'string' &&
        (typeof user.name === 'string' || user.name === null) &&
        typeof user.email === 'string'
    )
  );
}

async function fetchPage(fetcher: FetchLike, page: number): Promise<AdminUsersPage> {
  const response = await fetcher(`/api/admin/users?status=active&limit=${PAGE_SIZE}&page=${page}`);
  if (!response.ok) throw new Error('admin_users_fetch_failed');
  const payload = await response.json();
  if (!isAdminUsersPage(payload) || payload.pagination.page !== page) {
    throw new Error('admin_users_response_invalid');
  }
  return payload;
}

/** Load every active owner candidate while respecting the API's page cap. */
export async function fetchAllAdminUserOptions(
  fetcher: FetchLike = fetch
): Promise<AdminUserOption[]> {
  const first = await fetchPage(fetcher, 1);
  const pages: AdminUsersPage[] = [first];

  for (let start = 2; start <= first.pagination.totalPages; start += PAGE_BATCH_SIZE) {
    const end = Math.min(start + PAGE_BATCH_SIZE - 1, first.pagination.totalPages);
    const batch = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, index) => fetchPage(fetcher, start + index))
    );
    pages.push(...batch);
  }

  const unique = new Map<string, AdminUserOption>();
  for (const page of pages) {
    for (const user of page.users) unique.set(user.id, user);
  }
  return Array.from(unique.values());
}
