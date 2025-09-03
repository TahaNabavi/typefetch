import { z, ZodError } from "zod";
import { ApiClient, RichError } from "../client";
import { Contracts } from "../types";

// Mock fetch globally
global.fetch = jest.fn();

const contracts: Contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    createUser: {
      method: "POST",
      path: "/user",
      auth: true,
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
};

describe("ApiClient", () => {
  let client: ApiClient<typeof contracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
    client.init();
  });

  it("should initialize modules correctly", () => {
    expect(client.modules.user).toBeDefined();
    expect(typeof client.modules.user.getUser).toBe("function");
  });

  it("should call fetch with correct URL and headers", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const res = await client.modules.user.getUser({ id: "1" });
    expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
    expect(res).toEqual({ id: "1", name: "John" });
  });

  it("should throw validation error if input is invalid", async () => {
  await expect(client.modules.user.getUser({} as any))
    .rejects.toBeInstanceOf(ZodError);
});

  it("should handle auth header when token is provided", async () => {
    const authedClient = new ApiClient(
      { baseUrl: "https://api.test.com", token: "mytoken" },
      contracts
    );
    authedClient.init();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "2", name: "Alice" }),
    });

    await authedClient.modules.user.createUser({ name: "Alice" });

    expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mytoken",
      },
      body: JSON.stringify({ name: "Alice" }),
    });
  });

  it("should throw error if auth required and no token provided", async () => {
    await expect(
      client.modules.user.createUser({ name: "Alice" })
    ).rejects.toThrow(RichError);
  });

  it("should call errorHandler when error occurs", async () => {
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ message: "Invalid input" }),
    });

    await expect(client.modules.user.getUser({ id: "bad" })).rejects.toThrow();

    expect(handler).toHaveBeenCalled();
  });

  it("should apply responseTransform", async () => {
    client.useResponseTransform((data) => ({ ...data, transformed: true }));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const res = await client.modules.user.getUser({ id: "1" });
    expect(res).toEqual({ id: "1", name: "John", transformed: true });
  });

  it("should execute middleware in order", async () => {
    const logs: string[] = [];

    client.use(async (ctx, next) => {
      logs.push("before");
      const res = await next();
      logs.push("after");
      return res;
    });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    await client.modules.user.getUser({ id: "1" });

    expect(logs).toEqual(["before", "after"]);
  });
});
