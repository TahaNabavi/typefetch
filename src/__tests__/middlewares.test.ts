import { authMiddleware } from "../middlewares/auth";
import { cacheMiddleware } from "../middlewares/cache";
import { loggingMiddleware } from "../middlewares/logging";
import { retryMiddleware } from "../middlewares/retry";

describe("middlewares", () => {
  const mockCtx = (url = "/test", method = "GET") => ({
    url,
    init: { method, headers: {} as Record<string, string> },
  });

  const mockNext = (response: any = { ok: true, status: 200 }) =>
    jest.fn().mockResolvedValue(new Response(JSON.stringify(response)));

  // ---------------- AUTH ----------------
  it("authMiddleware should add refreshed token", async () => {
    const ctx = mockCtx();
    const next = mockNext();

    await authMiddleware(ctx, next, {
      refreshToken: async () => "NEW_TOKEN",
    });

    expect(ctx.init.headers["Authorization"]).toBe("Bearer NEW_TOKEN");
    expect(next).toHaveBeenCalled();
  });

  it("authMiddleware should skip if no refreshToken provided", async () => {
    const ctx = mockCtx();
    const next = mockNext();

    await authMiddleware(ctx, next, {});
    expect(ctx.init.headers["Authorization"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  // ---------------- CACHE ----------------
  it("cacheMiddleware should cache GET responses", async () => {
    const ctx = mockCtx("/users", "GET");
    const next = mockNext({ users: [1, 2, 3] });
    const middleware = cacheMiddleware({ ttl: 1000 });

    const res1 = await middleware(ctx, next);
    const res2 = await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1); // only first time
    const data2 = await res2.json();
    expect(data2.users).toEqual([1, 2, 3]);
  });

  it("cacheMiddleware should bypass cache for non-GET requests", async () => {
    const ctx = mockCtx("/users", "POST");
    const next = mockNext({ ok: true });
    const middleware = cacheMiddleware();

    await middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ---------------- LOGGING ----------------
  it("loggingMiddleware should log request and response", async () => {
    const ctx = mockCtx();
    const next = mockNext();

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await loggingMiddleware(ctx, next, {
      logRequest: true,
      logResponse: true,
      debug: true,
    });

    expect(logSpy).toHaveBeenCalledWith("➡️ Request:", ctx.url, ctx.init);
    expect(logSpy).toHaveBeenCalledWith("⬅️ Response:", 200);

    logSpy.mockRestore();
  });

  // ---------------- RETRY ----------------
  it("retryMiddleware should retry failed requests", async () => {
    const ctx = mockCtx();
    let attempt = 0;

    const next = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 2) throw new Error("fail");
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });

    const middleware = retryMiddleware({ maxRetries: 3, delay: 10 });

    const res = await middleware(ctx, next);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("retryMiddleware should throw after exceeding maxRetries", async () => {
    const ctx = mockCtx();
    const next = jest.fn().mockRejectedValue(new Error("fail always"));

    const middleware = retryMiddleware({ maxRetries: 2, delay: 10 });

    await expect(middleware(ctx, next)).rejects.toThrow("fail always");
    expect(next).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
