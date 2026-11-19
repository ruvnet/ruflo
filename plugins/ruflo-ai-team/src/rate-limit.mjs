// Fixed-window limiter for unauthenticated traffic only. It protects the public discovery and
// legal endpoints from scraping; it is not a usage limit and never applies to OAuth callers.
export class AnonRateLimiter {
  #hits = new Map();
  constructor({ perMinute = 120, maxKeys = 10_000, now = Date.now } = {}) { this.perMinute = perMinute; this.maxKeys = maxKeys; this.now = now; }
  get size() { return this.#hits.size; }
  take(key) {
    const t = this.now(); let entry = this.#hits.get(key);
    if (!entry || t - entry.start >= 60_000) {
      entry = { start: t, count: 0 };
      this.#hits.delete(key); this.#hits.set(key, entry);
      // Oldest windows go first, so a flood of distinct keys cannot grow memory without bound.
      while (this.#hits.size > this.maxKeys) this.#hits.delete(this.#hits.keys().next().value);
    }
    entry.count++;
    return entry.count <= this.perMinute ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((entry.start + 60_000 - t) / 1000)) };
  }
}

// Cloud Run appends the connecting client's address to X-Forwarded-For, so only the LAST entry is
// trustworthy; anything the caller put in front of it is attacker-controlled.
export function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : req.socket?.remoteAddress || 'unknown';
}
