import { z } from "zod";
import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  Middleware,
  ErrorLike,
  EndpointMethods,
  TokenProvider,
  RequestOptions,
} from "./types";

/**
 * A richer extension of the native Error class that captures
 * additional API error details such as HTTP status, code, and field errors.
 */
export class RichError extends Error implements ErrorLike {
  status?: number; // HTTP status code (e.g. 404, 500)
  code?: string; // Application-level error code (e.g. "USER_NOT_FOUND")
  title?: string; // Optional title or short summary
  detail?: string; // Additional human-readable explanation
  errors?: Record<string, string[]>; // Field-specific validation errors

  constructor(error: Partial<ErrorLike> & { message: string }) {
    super(error.message);
    Object.assign(this, error); // Copy all extra fields into this instance
  }
}

/**
 * ApiClient
 * =========
 * A robust, strongly-typed HTTP client that automatically builds API endpoint
 * methods from Zod-based contracts, providing:
 * - Input and response validation via Zod
 * - Middleware support
 * - Token-based authentication
 * - Error normalization (RichError)
 * - Optional caching, retries, and mock data
 */
export class ApiClient<C extends Contracts, E extends ErrorLike = RichError> {
  private middlewares: Array<{ fn: Middleware; options?: any }> = []; // Registered middlewares
  private errorHandler?: (error: E) => void; // Global error handler
  private responseTransform: (data: any) => any = (d) => d; // Post-parse data transformer
  private useMockData = false; // Whether mock responses are enabled
  private mockDelay = { min: 100, max: 1000 }; // Mock latency range (ms)
  private responseWrapper?: (successResponse: z.ZodTypeAny) => z.ZodTypeAny; // Wrapper for APIs with envelope structures
  private tokenProvider?: TokenProvider; // Optional async token supplier

  // Configuration for retry behavior
  private retryConfig?: {
    maxRetries: number;
    backoff: "fixed" | "linear" | "exponential";
    retryCondition?: (error: RichError, attempt: number) => boolean;
  };

  // Holds generated API endpoint methods
  private _modules!: { [M in keyof C]: EndpointMethods<C[M]> };

  constructor(
    private config: {
      baseUrl: string; // Base API URL
      token?: string; // Static token fallback
      tokenProvider?: TokenProvider; // Dynamic token supplier
      useMockData?: boolean; // Enable mock mode
      mockDelay?: { min: number; max: number }; // Simulated network delay
    },
    private contracts: C, // Strongly typed endpoint definitions
  ) {
    // Apply optional configurations
    this.useMockData = config.useMockData || false;
    this.mockDelay = config.mockDelay || { min: 100, max: 1000 };
    this.tokenProvider = config.tokenProvider;
  }

  /**
   * Builds all API methods (`modules`) dynamically from the Zod contract definition.
   * After `init()` is called, each endpoint can be invoked through `client.modules.moduleName.endpointName()`.
   */
  init() {
    const modules = {} as { [M in keyof C]: EndpointMethods<C[M]> };

    for (const moduleName in this.contracts) {
      const module = this.contracts[moduleName];
      (modules as any)[moduleName] = {} as EndpointMethods<typeof module>;

      for (const endpointName in module) {
        const endpoint = module[endpointName] as EndpointDefZ;

        // Each endpoint call is routed to the typed `request` method.
        (modules as any)[moduleName][endpointName] = (
          input: any,
          options?: RequestOptions,
        ) => this.request(endpoint as any, input, options);
      }
    }

    this._modules = modules;
  }

  /** Provides access to initialized modules after calling `init()`. */
  get modules() {
    return this._modules;
  }

  /** Registers a new middleware in the client’s pipeline. */
  use<T>(middleware: Middleware<T>, options?: T) {
    this.middlewares.push({ fn: middleware, options });
  }

  /** Sets a global error handler function to unify error behavior. */
  onError(handler: (error: E) => void) {
    this.errorHandler = handler;
  }

  /** Defines a global transform function applied to all validated responses. */
  useResponseTransform(fn: (data: any) => any) {
    this.responseTransform = fn;
  }

  /** Configures the retry logic (max attempts, backoff mode, etc.). */
  setRetryConfig(config: ApiClient<C>["retryConfig"]) {
    this.retryConfig = config;
  }

  /** Provides a custom token provider that returns tokens dynamically. */
  setTokenProvider(provider: TokenProvider) {
    this.tokenProvider = provider;
  }

  /** Enables mock responses instead of network requests. */
  setMockMode(enabled: boolean, delay?: { min: number; max: number }) {
    this.useMockData = enabled;
    if (delay) this.mockDelay = delay;
  }

  /** Registers a wrapper schema for APIs that nest response data (e.g. `{ data, success, message }`). */
  setResponseWrapper(wrapper: (successResponse: z.ZodTypeAny) => z.ZodTypeAny) {
    this.responseWrapper = wrapper;
  }

  /** Retrieves the current auth token, using a provider if available. */
  async getCurrentToken(): Promise<string | undefined> {
    if (this.tokenProvider) return await this.tokenProvider();
    return this.config.token;
  }

  /**
   * Core request entry point used by auto-generated endpoint methods.
   * Handles caching, deduplication, and mock mode routing.
   */
  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>,
    options?: RequestOptions,
  ): Promise<z.infer<TRes>> {
    const parsedInput = endpoint.request.parse(input); // Validate request against schema

    if (this.useMockData && endpoint.mockData) {
      return this.handleMockRequest(endpoint); // Serve mock data
    }

    const { url, body } = this.buildUrlAndBody(endpoint, parsedInput);

    const requestKey = JSON.stringify({ method: endpoint.method, url, body });

    const promise = this.performRequestLogic(
      endpoint,
      parsedInput,
      url,
      body,
      requestKey,
      options,
    );

    return promise;
  }

  /**
   * Full HTTP request workflow:
   * - Token injection
   * - Timeout support
   * - Middleware pipeline
   * - Fetch + response handling
   * - Zod parsing + transformation
   * - Caching
   */
  private async performRequestLogic<
    TReq extends z.ZodTypeAny,
    TRes extends z.ZodTypeAny,
  >(
    endpoint: EndpointDef<TReq, TRes>,
    parsedInput: z.infer<TReq>,
    url: string,
    body: BodyInit | undefined,
    key: string,
    options?: RequestOptions,
  ): Promise<z.infer<TRes>> {
    const headers: HeadersInit = {};
    const token = await this.getCurrentToken();

    // Handle auth requirements
    if (endpoint.auth && !token) {
      const error = this.createError({
        message: `Missing token for ${endpoint.path}`,
        status: 401,
        code: "NO_TOKEN",
      });
      this.errorHandler?.(error as any);
      throw error;
    }

    if (endpoint.auth && token) headers["Authorization"] = `Bearer ${token}`;
    if (endpoint.bodyType !== "form-data")
      headers["Content-Type"] = "application/json";

    // Initialize fetch context
    const ctx = {
      url,
      init: { method: endpoint.method, headers, body } as RequestInit,
    };

    // Timeout handling with abort support
    let controller: AbortController | undefined;
    let timeoutId: any;
    if (options?.timeout) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), options.timeout);
    }
    if (options?.signal || controller)
      ctx.init.signal = options?.signal || controller?.signal;

    // Build the middleware chain (last = fetch)
    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      () => fetch(ctx.url, ctx.init),
    );

    // Retry-enabled execution function
    const execute = async () => {
      const res = await runner();
      const json = await res.json();
      let responseData = json;

      // Handle wrapped APIs (e.g. `{ success, data, ... }`)
      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedWrapped = wrappedSchema.parse(json);

        if (parsedWrapped.success === false) {
          const error = this.createError({
            message: parsedWrapped.message || "Request failed",
            status: parsedWrapped.code || res.status,
            code: `API_ERROR_${parsedWrapped.code}`,
          });
          this.errorHandler?.(error as any);
          throw error;
        }
        responseData = parsedWrapped.data;
      }

      // Handle HTTP errors
      if (!res.ok) {
        const error = this.createError({
          message: json.message || res.statusText,
          status: res.status,
          code: json.code,
          title: json.title,
          detail: json.detail,
          errors: json.errors,
        });
        this.errorHandler?.(error as any);
        throw error;
      }

      // Validate and transform response
      const parsed = endpoint.response.parse(responseData);
      const result = this.responseTransform(parsed);

      return result;
    };

    // Execute with retry and normalized error handling
    try {
      const result = await this.executeWithRetry(execute);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const error = this.normalizeError(err);
      this.errorHandler?.(error as any);
      throw error;
    }
  }

  // =========================================================
  // 🔁 RETRY ENGINE
  // =========================================================

  /** Executes a function with retry logic and configurable backoff strategy. */
  private async executeWithRetry(fn: () => Promise<any>): Promise<any> {
    if (!this.retryConfig) return fn();

    const { maxRetries, backoff, retryCondition } = this.retryConfig;
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;
        const error = this.normalizeError(err);

        const shouldRetry =
          attempt <= maxRetries &&
          (retryCondition?.(error, attempt) ??
            (error.status !== undefined && error.status >= 500));

        if (!shouldRetry) throw error;

        const delay = this.getBackoffDelay(backoff, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /** Calculates retry delay intervals for various backoff strategies. */
  private getBackoffDelay(
    type: "fixed" | "linear" | "exponential",
    attempt: number,
  ) {
    const base = 300;
    switch (type) {
      case "fixed":
        return base;
      case "linear":
        return base * attempt;
      case "exponential":
        return base * Math.pow(2, attempt - 1);
    }
  }

  // =========================================================
  // 🔧 UTILITIES
  // =========================================================

  /** Builds the final URL and request body from the endpoint definition and input payload. */
  private buildUrlAndBody(endpoint: any, input: any) {
    let url = this.config.baseUrl + endpoint.path;
    let body: BodyInit | undefined;

    if (endpoint.method !== "GET") {
      if (endpoint.bodyType === "form-data") {
        const form = new FormData();
        for (const [k, v] of Object.entries(input.body || {})) {
          if (v != null) form.append(k, v as any);
        }
        body = form;
      } else {
        body = JSON.stringify(input.body ?? input);
      }
    }

    return { url, body };
  }

  /** Creates and returns a RichError from details. */
  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

  /**
   * Converts any thrown error to a standardized RichError instance.
   * Also flattens Zod validation errors into readable messages.
   */
  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    if (err instanceof z.ZodError) {
      return this.createError({
        message: `Validation error: ${err.errors.map((e) => e.message).join(", ")}`,
        code: "VALIDATION_ERROR",
      });
    }
    return this.createError({ message: err.message || "Unknown error" });
  }

  /**
   * Handles mock-mode requests by simulating a delayed network call
   * and returning validated mock data.
   */
  private async handleMockRequest(endpoint: any) {
    const delay =
      Math.floor(
        Math.random() * (this.mockDelay.max - this.mockDelay.min + 1),
      ) + this.mockDelay.min;

    await new Promise((r) => setTimeout(r, delay)); // Simulate latency

    const data =
      typeof endpoint.mockData === "function"
        ? endpoint.mockData()
        : endpoint.mockData;

    return this.responseTransform(endpoint.response.parse(data));
  }
}
