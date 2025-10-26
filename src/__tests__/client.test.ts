import { z, ZodError } from "zod";
import { ApiClient, RichError } from "../client";
import { Contracts } from "../types";

global.fetch = jest.fn();

const contracts: Contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Add mock data for testing
      mockData: { id: "mock-1", name: "Mock User" },
    },
    createUser: {
      method: "POST",
      path: "/user",
      auth: true,
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Add dynamic mock data function
      mockData: () => ({
        id: `mock-${Math.random().toString(36).substr(2, 6)}`,
        name: "Dynamic Mock User",
      }),
    },
    listUsers: {
      method: "GET",
      path: "/users",
      request: z.object({}),
      response: z.array(z.object({ id: z.string(), name: z.string() })),
      // No mock data for this endpoint
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
    await expect(client.modules.user.getUser({} as any)).rejects.toBeInstanceOf(
      ZodError
    );
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

  describe("Mock Data Feature", () => {
    it("should use mock data when mock mode is enabled", async () => {
      client.setMockMode(true, { min: 0, max: 0 });
      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should use dynamic mock data function when provided", async () => {
      client.setMockMode(true, { min: 0, max: 0 });

      const result1 = await client.modules.user.createUser({ name: "Test" });
      const result2 = await client.modules.user.createUser({ name: "Test" });

      expect(result1.id).toMatch(/^mock-/);
      expect(result1.name).toBe("Dynamic Mock User");
      expect(result2.id).not.toBe(result1.id);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should fall back to real API when mock data is not provided", async () => {
      client.setMockMode(true, { min: 0, max: 0 });

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "1", name: "User1" }],
      });

      const result = await client.modules.user.listUsers({});

      expect(result).toEqual([{ id: "1", name: "User1" }]);
      expect(fetch).toHaveBeenCalled();
    });

    it("should add random delay when using mock data", async () => {
      const mockDateNow = jest
        .spyOn(Date, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(100);

      client.setMockMode(true, { min: 100, max: 100 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();

      mockDateNow.mockRestore();
    });

    it("should toggle mock mode at runtime", async () => {
      client.setMockMode(true, { min: 0, max: 0 });
      let result = await client.modules.user.getUser({ id: "1" });
      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();

      client.setMockMode(false);
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "real-1", name: "Real User" }),
      });

      result = await client.modules.user.getUser({ id: "1" });
      expect(result).toEqual({ id: "real-1", name: "Real User" });
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe("Response Wrapper Feature", () => {
    const createApiResponseWrapper = (successResponse: z.ZodTypeAny) =>
      z.union([
        z.object({
          success: z.literal(true),
          data: successResponse,
          timestamp: z.string(),
          requestId: z.string(),
        }),
        z.object({
          success: z.literal(false),
          message: z.string(),
          code: z.number(),
          timestamp: z.string(),
          requestId: z.string(),
        }),
      ]);

    it("should validate and unwrap successful wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John" });
    });

    it("should throw error for failed wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: "User not found",
          code: 404,
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      await expect(client.modules.user.getUser({ id: "999" })).rejects.toThrow(
        RichError
      );
    });

    it("should work with mock data and response wrapper", async () => {
      client.setResponseWrapper(createApiResponseWrapper);
      client.setMockMode(true, { min: 0, max: 0 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
    });

    it("should throw validation error for invalid wrapped response format", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invalid: "format",
        }),
      });

      try {
        await client.modules.user.getUser({ id: "1" });
        fail("Expected error to be thrown");
      } catch (error: any) {
        expect(error.message).toContain("ZodError");
        expect(error.message).toContain("invalid_union");
      }
    });

    it("should handle response transform with wrapper", async () => {
      client.setResponseWrapper(createApiResponseWrapper);
      client.useResponseTransform((data) => ({ ...data, transformed: true }));

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John", transformed: true });
    });
  });

  describe("Integration: Mock Data + Response Wrapper", () => {
    it("should handle both features together", async () => {
      const wrapper = (successResponse: z.ZodTypeAny) =>
        z.union([
          z.object({
            success: z.literal(true),
            data: successResponse,
            timestamp: z.string(),
            requestId: z.string(),
          }),
          z.object({
            success: z.literal(false),
            message: z.string(),
            code: z.number(),
            timestamp: z.string(),
            requestId: z.string(),
          }),
        ]);

      client.setResponseWrapper(wrapper);
      client.setMockMode(true, { min: 0, max: 0 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
    });
  });
});
