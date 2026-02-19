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
  admin: {
    // Add this missing module
    getAdminData: {
      method: "GET",
      path: "/admin/data",
      auth: true,
      request: z.object({}),
      response: z.object({ secret: z.string() }),
      mockData: { secret: "admin-secret" },
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
      ZodError,
    );
  });

  it("should handle auth header when token is provided", async () => {
    const authedClient = new ApiClient(
      { baseUrl: "https://api.test.com", token: "mytoken" },
      contracts,
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
      client.modules.user.createUser({ name: "Alice" }),
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
        RichError,
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
        expect(error.message).toContain("Validation error");
        expect(error.message).toMatch(/validation|invalid/i);
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

  describe("Token Provider Feature", () => {
    it("should use tokenProvider when provided in constructor", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should use tokenProvider over static token when both provided", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithBoth = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "static-token",
          tokenProvider,
        },
        contracts,
      );
      clientWithBoth.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithBoth.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should work with async tokenProvider", async () => {
      const tokenProvider = jest.fn().mockResolvedValue("async-token");
      const clientWithAsyncProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithAsyncProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithAsyncProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer async-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should set tokenProvider dynamically after initialization", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");

      // Client without initial token provider
      const clientWithoutProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
        },
        contracts,
      );
      clientWithoutProvider.init();

      // Set token provider after initialization
      clientWithoutProvider.setTokenProvider(tokenProvider);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithoutProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should get current token from tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("current-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      const token = await clientWithProvider.getCurrentToken();

      expect(tokenProvider).toHaveBeenCalled();
      expect(token).toBe("current-token");
    });

    it("should get current token from static config when no tokenProvider", async () => {
      const clientWithStaticToken = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "static-token",
        },
        contracts,
      );
      clientWithStaticToken.init();

      const token = await clientWithStaticToken.getCurrentToken();

      expect(token).toBe("static-token");
    });

    it("should return undefined when no token or tokenProvider", async () => {
      const clientWithoutToken = new ApiClient(
        {
          baseUrl: "https://api.test.com",
        },
        contracts,
      );
      clientWithoutToken.init();

      const token = await clientWithoutToken.getCurrentToken();

      expect(token).toBeUndefined();
    });

    it("should handle tokenProvider returning empty string", async () => {
      const tokenProvider = jest.fn().mockReturnValue("");
      const clientWithEmptyProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithEmptyProvider.init();

      await expect(
        clientWithEmptyProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow(RichError);

      expect(tokenProvider).toHaveBeenCalled();
    });

    it("should handle tokenProvider returning null/undefined", async () => {
      const tokenProvider = jest.fn().mockReturnValue(null);
      const clientWithNullProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithNullProvider.init();

      await expect(
        clientWithNullProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow(RichError);

      expect(tokenProvider).toHaveBeenCalled();
    });

    it("should work with tokenProvider for non-auth endpoints", async () => {
      const tokenProvider = jest.fn().mockReturnValue("some-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      const result = await clientWithProvider.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John" });
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(fetchCall.headers).not.toHaveProperty("Authorization");
    });

    it("should call tokenProvider for each auth request", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "1", name: "User1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "2", name: "User2" }),
        });

      await clientWithProvider.modules.user.createUser({ name: "User1" });
      await clientWithProvider.modules.user.createUser({ name: "User2" });

      expect(tokenProvider).toHaveBeenCalledTimes(2);
    });

    it("should work with mock data and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("mock-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
          useMockData: true,
        },
        contracts,
      );
      clientWithProvider.init();

      const result = await clientWithProvider.modules.user.createUser({
        name: "Test",
      });

      expect(result.id).toMatch(/^mock-/);
      expect(result.name).toBe("Dynamic Mock User");
      // Token provider should not be called when using mock data
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should handle tokenProvider errors gracefully", async () => {
      const tokenProvider = jest.fn().mockImplementation(() => {
        throw new Error("Token provider failed");
      });
      const clientWithFailingProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithFailingProvider.init();

      await expect(
        clientWithFailingProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow("Token provider failed");
    });

    it("should work with response wrapper and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("wrapper-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      clientWithProvider.setResponseWrapper((successResponse) =>
        z.union([
          z.object({
            success: z.literal(true),
            data: successResponse,
          }),
          z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        ]),
      );

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
        }),
      });

      const result = await clientWithProvider.modules.user.createUser({
        name: "Alice",
      });

      expect(tokenProvider).toHaveBeenCalled();
      expect(result).toEqual({ id: "1", name: "John" });
    });

    it("should work with multiple modules and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("multi-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "1", name: "User1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ secret: "admin-data" }),
        });

      await clientWithProvider.modules.user.createUser({ name: "User1" });
      await clientWithProvider.modules.admin.getAdminData({});

      expect(tokenProvider).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(1, "https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer multi-token",
        },
        body: JSON.stringify({ name: "User1" }),
      });
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://api.test.com/admin/data",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer multi-token",
          },
          body: undefined,
        },
      );
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
        RichError,
      );
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
        expect(error.message).toContain("Validation error");
        expect(error.message).toMatch(/validation|invalid/i);
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
