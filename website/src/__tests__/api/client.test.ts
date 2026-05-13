import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '../../api/client';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('apiFetch', () => {
  it('sends a GET request with correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ items: [] }),
    });

    await apiFetch('get', '/api/news' as never);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/news',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends a POST request with JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: '1' }),
    });

    await apiFetch('post', '/api/news' as never, { body: { title: 'Test' } as never });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 'Test' });
  });

  it('builds query string from params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await apiFetch('get', '/api/news' as never, { query: { section: 'seniors' } as never });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/news?section=seniors');
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ items: [{ title: 'Hello' }] }),
    });

    const result = await apiFetch('get', '/api/news' as never);
    expect((result as { items: { title: string }[] }).items[0].title).toBe('Hello');
  });

  it('throws on non-ok response with error field', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'Forbidden' }),
    });

    await expect(apiFetch('get', '/api/news' as never)).rejects.toThrow('Forbidden');
  });

  it('throws generic message when error field is absent', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    });

    await expect(apiFetch('get', '/api/news' as never)).rejects.toThrow('Request failed (500)');
  });

  it('includes credentials and custom headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });

    await apiFetch('get', '/api/news' as never, { headers: { 'X-Club-Slug': 'test-club' } });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Club-Slug']).toBe('test-club');
  });

  it('omits null and undefined query params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });

    await apiFetch('get', '/api/news' as never, {
      query: { section: 'all', other: undefined } as never,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain('other');
  });
});
