import { MiddlewareContext, MiddlewareNext } from "@/types";

export type CacheOptions = { ttl?: number };

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 60000 } = options;
  const cache = new Map<string, { data: any; expires: number }>();

  return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
    if (ctx.init.method === "GET") {
      const cached = cache.get(ctx.url);
      const now = Date.now();
      if (cached && cached.expires > now)
        return new Response(JSON.stringify(cached.data));

      const res = await next();
      const data = await res
        .clone()
        .json()
        .catch(() => null);
      if (data) cache.set(ctx.url, { data, expires: now + ttl });
      return res;
    }
    return next();
  };
};
