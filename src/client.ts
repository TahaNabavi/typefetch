import { z } from "zod";
import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  Middleware,
  ErrorLike,
  EndpointMethods,
  TokenProvider,
} from "./types";

export class RichError extends Error implements ErrorLike {
  status?: number;
  code?: string;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;

  constructor(error: Partial<ErrorLike> & { message: string }) {
    super(error.message);
    Object.assign(this, error);
  }
}

/**
 * Strongly-typed HTTP client built from Zod contracts.
 *
 * Features:
 * - Type-safe request & response based on Zod schemas
 * - Path/query/body support via { path?, query?, body? } shape
 * - Backwards compatible with flat request bodies
 * - Pluggable middleware pipeline
 * - Token and tokenProvider support
 * - Mock mode with configurable delay
 * - Optional response wrapper for APIs that nest data
 */
export class ApiClient<C extends Contracts, E extends ErrorLike = RichError> {
  private middlewares: Array<{ fn: Middleware; options?: any }> = [];
  private errorHandler?: (error: E) => void;
  private responseTransform: (data: any) => any = (d) => d;
  private useMockData: boolean = false;
  private mockDelay: { min: number; max: number } = { min: 100, max: 1000 };
  private responseWrapper?: (successResponse: z.ZodTypeAny) => z.ZodTypeAny;
  private tokenProvider?: TokenProvider;

  private _modules!: {
    [M in keyof C]: EndpointMethods<C[M]>;
  };

  constructor(
    private config: {
      baseUrl: string;
      token?: string;
      tokenProvider?: TokenProvider;
      useMockData?: boolean;
      mockDelay?: { min: number; max: number };
    },
    private contracts: C
  ) {
    this.useMockData = config.useMockData || false;
    this.mockDelay = config.mockDelay || { min: 100, max: 1000 };
    this.tokenProvider = config.tokenProvider;
  }

  /**
   * Builds the strongly-typed `modules` API from the provided contracts.
   * Must be called once after constructing the client.
   */
  init() {
    const modules = {} as {
      [M in keyof C]: EndpointMethods<C[M]>;
    };

    for (const moduleName in this.contracts) {
      const module = this.contracts[moduleName];
      (modules as any)[moduleName] = {} as EndpointMethods<typeof module>;

      for (const endpointName in module) {
        const endpoint = module[endpointName] as EndpointDefZ;

        (modules as any)[moduleName][endpointName] = (
          input: z.infer<(typeof endpoint)["request"]>
        ) => this.request(endpoint as any, input as any);
      }
    }

    this._modules = modules;
  }

  /**
   * Type-safe entrypoint for calling API endpoints.
   * Populated by `init()` based on the `contracts` passed to the constructor.
   */
  get modules() {
    return this._modules;
  }

  /**
   * Registers a middleware in the pipeline.
   * Middlewares are executed in reverse order of registration.
   */
  use<T>(middleware: Middleware<T>, options?: T) {
    this.middlewares.push({ fn: middleware, options });
  }

  /**
   * Registers a global error handler.
   * The handler is invoked for normalized errors before they are re-thrown.
   */
  onError(handler: (error: E) => void) {
    this.errorHandler = handler;
  }

  /**
   * Registers a transformation function applied to all successful responses
   * after Zod parsing.
   */
  useResponseTransform(fn: (data: any) => any) {
    this.responseTransform = fn;
  }

  /**
   * Enables or disables mock mode. When enabled, endpoints with `mockData`
   * return mocked responses instead of performing network requests.
   */
  setMockMode(enabled: boolean, delay?: { min: number; max: number }) {
    this.useMockData = enabled;
    if (delay) {
      this.mockDelay = delay;
    }
  }

  /**
   * Registers a schema wrapper for APIs that wrap data in an envelope.
   * Example: { success, data, message, code, ... }.
   */
  setResponseWrapper(wrapper: (successResponse: z.ZodTypeAny) => z.ZodTypeAny) {
    this.responseWrapper = wrapper;
  }

  /**
   * Sets or updates the token provider used for authenticated endpoints.
   * Overrides any static token provided in the constructor.
   */
  setTokenProvider(provider: TokenProvider) {
    this.tokenProvider = provider;
  }

  /**
   * Returns the current token, preferring the tokenProvider if present,
   * otherwise falling back to the static token from the constructor.
   */
  async getCurrentToken(): Promise<string | undefined> {
    if (this.tokenProvider) {
      return await this.tokenProvider();
    }
    return this.config.token;
  }

  /**
   * Executes a single endpoint request.
   *
   * Expected request shape (new style):
   *   z.object({
   *     path: z.object({...}).optional(),
   *     query: z.object({...}).optional(),
   *     body: z.any().optional(),
   *   })
   *
   * If the parsed request does not contain `path`, `query` or `body`,
   * the entire input is treated as the legacy flat request body.
   */
  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>
  ): Promise<z.infer<TRes>> {
    const parsedInput = endpoint.request.parse(input);

    if (this.useMockData && endpoint.mockData) {
      return this.handleMockRequest(endpoint);
    }

    let token = this.config.token;
    if (this.tokenProvider) {
      token = await this.tokenProvider();
    }

    if (endpoint.auth && !token) {
      const error = this.createError({
        message: `Missing token for ${endpoint.path}`,
        status: 401,
        code: "NO_TOKEN",
      });
      this.errorHandler?.(error as unknown as E);
      throw error;
    }

    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (endpoint.auth && token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const { url, body } = this.buildUrlAndBody(endpoint, parsedInput);

    const ctx = {
      url,
      init: {
        method: endpoint.method,
        headers,
        body,
      },
    };

    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      () => fetch(ctx.url, ctx.init)
    );

    try {
      const res = await runner();
      const json = await res.json();

      let responseData = json;

      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedResponse = wrappedSchema.parse(json);

        if (parsedResponse.success === false) {
          const error = this.createError({
            message: parsedResponse.message || "Request failed",
            status: parsedResponse.code || res.status,
            code: `API_ERROR_${parsedResponse.code}`,
          });
          this.errorHandler?.(error as unknown as E);
          throw error;
        }

        responseData = parsedResponse.data;
      }

      if (!res.ok) {
        const error = this.createError({
          message: json.message || res.statusText,
          status: res.status,
          code: json.code,
          title: json.title,
          detail: json.detail,
          errors: json.errors,
        });
        this.errorHandler?.(error as unknown as E);
        throw error;
      }

      return this.responseTransform(endpoint.response.parse(responseData));
    } catch (err: any) {
      const error = this.normalizeError(err);
      this.errorHandler?.(error as unknown as E);
      throw error;
    }
  }

  /**
   * Builds the effective URL and request body for an endpoint.
   *
   * - Legacy mode: if the input does not contain `path`, `query` or `body`,
   *   the entire input is used as the JSON request body for non-GET methods.
   *
   * - New mode: uses `path` to interpolate `:param` segments, `query` to
   *   construct the query string, and `body` as the JSON payload.
   */
  private buildUrlAndBody<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    parsedInput: z.infer<TReq>
  ) {
    const isObject = typeof parsedInput === "object" && parsedInput !== null;

    const hasNewShape =
      isObject &&
      ("path" in (parsedInput as any) ||
        "query" in (parsedInput as any) ||
        "body" in (parsedInput as any));

    if (!hasNewShape) {
      const url = this.config.baseUrl + endpoint.path;
      let requestBody: string | undefined = undefined;

      if (endpoint.method !== "GET") {
        requestBody = JSON.stringify(parsedInput);
      }

      return { url, body: requestBody };
    }

    const { path, query, body } = parsedInput as any as {
      path?: Record<string, any>;
      query?: Record<string, any>;
      body?: any;
    };

    let url = this.config.baseUrl + endpoint.path;

    if (path) {
      for (const [key, value] of Object.entries(path)) {
        if (value === undefined || value === null) continue;

        const token = `:${key}`;
        if (!url.includes(token)) {
          continue;
        }

        url = url.replace(token, encodeURIComponent(String(value)));
      }
    }

    const missingTokens = Array.from(url.matchAll(/:([A-Za-z0-9_]+)/g)).map(
      (m) => m[1]
    );

    if (missingTokens.length > 0) {
      throw this.createError({
        message: `Missing path params for placeholders: ${missingTokens.join(
          ", "
        )} in "${endpoint.path}"`,
        code: "MISSING_PATH_PARAMS",
      });
    }

    if (query) {
      const searchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          for (const v of value) {
            if (v === undefined || v === null) continue;
            searchParams.append(key, String(v));
          }
        } else if (typeof value === "object") {
          searchParams.append(key, JSON.stringify(value));
        } else {
          searchParams.append(key, String(value));
        }
      }

      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }

    let requestBody: string | undefined = undefined;

    if (endpoint.method !== "GET") {
      if (typeof body !== "undefined" && body !== null) {
        requestBody = JSON.stringify(body);
      }
    }

    return { url, body: requestBody };
  }

  /**
   * Returns a mocked response based on `endpoint.mockData`,
   * respecting the configured mock delay and response wrapper.
   */
  private async handleMockRequest<
    TReq extends z.ZodTypeAny,
    TRes extends z.ZodTypeAny
  >(endpoint: EndpointDef<TReq, TRes>): Promise<z.infer<TRes>> {
    const delay = this.getRandomDelay();
    await new Promise((resolve) => setTimeout(resolve, delay));

    let mockData: z.infer<TRes>;
    if (typeof endpoint.mockData === "function") {
      mockData = (endpoint.mockData as () => z.infer<TRes>)();
    } else {
      mockData = endpoint.mockData as z.infer<TRes>;
    }

    if (this.responseWrapper) {
      const wrappedSchema = this.responseWrapper(endpoint.response);

      const mockWrappedResponse = {
        success: true,
        data: mockData,
        timestamp: new Date().toISOString(),
        requestId: `mock-${Math.random().toString(36).substr(2, 9)}`,
      };

      const parsedWrappedResponse = wrappedSchema.parse(mockWrappedResponse);
      return this.responseTransform(
        endpoint.response.parse(parsedWrappedResponse.data)
      );
    }

    return this.responseTransform(endpoint.response.parse(mockData));
  }

  /**
   * Returns a random delay in milliseconds within the current mock delay range.
   */
  private getRandomDelay(): number {
    return (
      Math.floor(
        Math.random() * (this.mockDelay.max - this.mockDelay.min + 1)
      ) + this.mockDelay.min
    );
  }

  /**
   * Creates a RichError instance from a partial error description.
   */
  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

  /**
   * Normalizes unknown errors into a RichError instance.
   * Zod validation errors are converted into a standardized validation error.
   */
  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    if (err instanceof z.ZodError) {
      return this.createError({
        message: `Validation error: ${err.errors
          .map((e) => e.message)
          .join(", ")}`,
        code: "VALIDATION_ERROR",
      });
    }
    return this.createError({ message: err.message || "Unknown error" });
  }
}
