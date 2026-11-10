/**
 * #4503 follow-up: http_fetch validated only the initial URL and let fetch
 * follow redirects automatically. A public URL could therefore redirect to
 * loopback/RFC1918/cloud-metadata (or another protocol) without ever passing
 * validateUrl(). Redirects are now followed manually and every hop is checked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpFetchExecute, type HttpFetchRequest } from '../src/mcp-tools/http-fetch-tools.js';

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function ok(body = 'final'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH;
});

describe('http_fetch redirect SSRF guard', () => {
  it('blocks a public -> loopback redirect without issuing the second request', async () => {
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockResolvedValueOnce(redirect('http://127.0.0.1:8080/secret'));

    const result = await httpFetchExecute({ url: 'https://example.com/start' }, { request: fetchMock });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRIVATE_ADDRESS');
    expect(result.error).toContain('redirect blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to cloud metadata via an IPv4-mapped IPv6 literal', async () => {
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockResolvedValueOnce(redirect('http://[::ffff:169.254.169.254]/latest/meta-data/'));

    const result = await httpFetchExecute({ url: 'https://example.com/start' }, { request: fetchMock });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRIVATE_ADDRESS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect that switches to a non-http protocol', async () => {
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockResolvedValueOnce(redirect('file:///etc/passwd'));

    const result = await httpFetchExecute({ url: 'https://example.com/start' }, { request: fetchMock });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FORBIDDEN_PROTOCOL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a validated public relative redirect and reports the final URL', async () => {
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockResolvedValueOnce(redirect('/final'))
      .mockResolvedValueOnce(ok('redirected-body'));

    const result = await httpFetchExecute({ url: 'https://example.com/start' }, { request: fetchMock });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('redirected-body');
    expect(result.url).toBe('https://example.com/final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/final');
  });

  it('drops Authorization when a redirect crosses origins', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH = '1';
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockResolvedValueOnce(redirect('https://other.example/final'))
      .mockResolvedValueOnce(ok());

    const result = await httpFetchExecute({
      url: 'https://example.com/start',
      headers: { Authorization: 'Bearer secret' },
    }, { request: fetchMock });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = fetchMock.mock.calls[1][1];
    expect(secondInit.headers).not.toHaveProperty('Authorization');
  });

  it('stops at the redirect limit', async () => {
    const fetchMock = vi.fn<HttpFetchRequest>()
      .mockImplementation(async () => redirect('/again'));

    const result = await httpFetchExecute({ url: 'https://example.com/start' }, { request: fetchMock });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('REDIRECT_LIMIT');
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });
});
