"use strict";

// Wraps an async fetcher so concurrent callers share one in-flight request and
// results are reused for `ttlMs`. Failures are never cached.
function cached(fetcher, ttlMs) {
  let value;
  let valueAt = 0;
  let pending = null;

  const get = () => {
    if (valueAt && Date.now() - valueAt < ttlMs) return Promise.resolve(value);
    if (pending) return pending;
    pending = Promise.resolve()
      .then(fetcher)
      .then((result) => {
        value = result;
        valueAt = Date.now();
        return result;
      })
      .finally(() => { pending = null; });
    return pending;
  };
  get.invalidate = () => { valueAt = 0; };
  return get;
}

module.exports = { cached };
