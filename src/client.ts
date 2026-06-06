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
  MiddlewareContext,
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

type ParsedRequestParts = {
  path?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  headers: Record<string, string>;
  isStructured: boolean;
};

const REQUEST_PART_KEYS = new Set([
  "path",
  "query",
  "body",
  "headers",
  "header",
]);

export class ApiClient<C extends Contracts, E extends ErrorLike = RichError> {
  private middlewares: Array<{ fn: Middleware; options?: any }> = [];
  private errorHandler?: (error: E) => void;
  private responseTransform: (data: any) => any = (d) => d;
  private useMockData = false;
  private mockDelay = { min: 100, max: 1000 };
  private responseWrapper?: (successResponse: z.ZodTypeAny) => z.ZodTypeAny;
  private tokenProvider?: TokenProvider;

  private retryConfig?: {
    maxRetries: number;
    backoff: "fixed" | "linear" | "exponential";
    retryCondition?: (error: RichError, attempt: number) => boolean;
  };

  private _modules!: { [M in keyof C]: EndpointMethods<C[M]> };

  constructor(
    private config: {
      baseUrl: string;
      token?: string;
      tokenProvider?: TokenProvider;
      useMockData?: boolean;
      mockDelay?: { min: number; max: number };
    },
    private contracts: C,
  ) {
    this.useMockData = config.useMockData || false;
    this.mockDelay = config.mockDelay || { min: 100, max: 1000 };
    this.tokenProvider = config.tokenProvider;
  }

  init() {
    const modules = {} as { [M in keyof C]: EndpointMethods<C[M]> };

    for (const moduleName in this.contracts) {
      const module = this.contracts[moduleName];
      (modules as any)[moduleName] = {} as EndpointMethods<typeof module>;

      for (const endpointName in module) {
        const endpoint = module[endpointName] as EndpointDefZ;

        (modules as any)[moduleName][endpointName] = (
          input: any,
          options?: RequestOptions,
        ) => this.request(endpoint as any, input, options);
      }
    }

    this._modules = modules;
  }

  get modules() {
    return this._modules;
  }

  use<T>(middleware: Middleware<any, any, T>, options?: T) {
    this.middlewares.push({ fn: middleware, options });
  }

  onError(handler: (error: E) => void) {
    this.errorHandler = handler;
  }

  useResponseTransform(fn: (data: any) => any) {
    this.responseTransform = fn;
  }

  setRetryConfig(config: ApiClient<C>["retryConfig"]) {
    this.retryConfig = config;
  }

  setTokenProvider(provider: TokenProvider) {
    this.tokenProvider = provider;
  }

  setMockMode(enabled: boolean, delay?: { min: number; max: number }) {
    this.useMockData = enabled;
    if (delay) this.mockDelay = delay;
  }

  setResponseWrapper(wrapper: (successResponse: z.ZodTypeAny) => z.ZodTypeAny) {
    this.responseWrapper = wrapper;
  }

  async getCurrentToken(): Promise<string | undefined> {
    if (this.tokenProvider) return await this.tokenProvider();
    return this.config.token;
  }

  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>,
    options?: RequestOptions,
  ): Promise<z.infer<TRes>> {
    const parsedInput = endpoint.request.parse(input);

    if (this.useMockData && endpoint.mockData) {
      return this.handleMockRequest(endpoint);
    }

    const built = this.buildUrlAndBody(endpoint as EndpointDefZ, parsedInput);

    return this.performRequestLogic(
      endpoint,
      parsedInput,
      built.url,
      built.body,
      built.headers,
      built.parts,
      options,
    );
  }

  private async performRequestLogic<
    TReq extends z.ZodTypeAny,
    TRes extends z.ZodTypeAny,
  >(
    endpoint: EndpointDef<TReq, TRes>,
    parsedInput: z.infer<TReq>,
    url: string,
    body: BodyInit | undefined,
    requestHeaders: Record<string, string>,
    requestParts: ParsedRequestParts,
    options?: RequestOptions,
  ): Promise<z.infer<TRes>> {
    const headers: Record<string, string> = {};

    if (endpoint.bodyType !== "form-data") {
      headers["Content-Type"] = "application/json";
    }

    const endpointHeaders =
      typeof endpoint.headers === "function"
        ? endpoint.headers(parsedInput)
        : endpoint.headers;

    Object.assign(
      headers,
      this.normalizeHeaders(endpointHeaders),
      requestHeaders,
    );

    if (endpoint.auth) {
      const token = await this.getCurrentToken();

      if (!token) {
        const error = this.createError({
          message: `Missing token for ${endpoint.path}`,
          status: 401,
          code: "NO_TOKEN",
        });
        this.errorHandler?.(error as any);
        throw error;
      }

      headers["Authorization"] = `Bearer ${token}`;
    }

    const ctx = {
      url,
      init: { method: endpoint.method, headers, body } as RequestInit,
      endpoint: endpoint as never,
      request: {
        ...requestParts,
        rawInput: parsedInput,
      },
    } satisfies MiddlewareContext;

    let controller: AbortController | undefined;
    let timeoutId: any;

    if (options?.timeout) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), options.timeout);
    }

    if (options?.signal || controller) {
      ctx.init.signal = options?.signal || controller?.signal;
    }

    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      () => fetch(ctx.url, ctx.init),
    );

    const execute = async () => {
      const res = await runner();
      const json = await res.json();
      let responseData = json;

      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedWrapped = wrappedSchema.parse(json) as any;

        if (parsedWrapped.success === false) {
          const error = this.createError({
            message:
              parsedWrapped.message || parsedWrapped.error || "Request failed",
            status: parsedWrapped.code || res.status,
            code: parsedWrapped.code
              ? `API_ERROR_${parsedWrapped.code}`
              : "API_ERROR",
          });

          this.errorHandler?.(error as any);
          throw error;
        }

        responseData = parsedWrapped.data;
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
        this.errorHandler?.(error as any);
        throw error;
      }

      const parsed = endpoint.response.parse(responseData);
      return this.responseTransform(parsed);
    };

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

  private buildUrlAndBody(endpoint: EndpointDefZ, input: any) {
    const parts = this.extractRequestParts(input);

    let url = this.config.baseUrl + endpoint.path;
    url = this.applyPathParams(url, parts.path);
    url = this.appendQueryParams(url, parts.query);

    let body: BodyInit | undefined;
    const payload = parts.isStructured ? parts.body : input;

    if (endpoint.method !== "GET" && payload !== undefined) {
      if (endpoint.bodyType === "form-data") {
        if (typeof FormData !== "undefined" && payload instanceof FormData) {
          body = payload;
        } else {
          const form = new FormData();

          if (this.isObjectRecord(payload)) {
            for (const [key, value] of Object.entries(payload)) {
              this.appendFormValue(form, key, value);
            }
          } else if (payload != null) {
            form.append("value", String(payload));
          }

          body = form;
        }
      } else {
        body = JSON.stringify(payload);
      }
    }

    return { url, body, headers: parts.headers, parts };
  }

  private extractRequestParts(input: any): ParsedRequestParts {
    if (this.isStructuredRequestInput(input)) {
      return {
        path: this.isObjectRecord(input.path) ? input.path : undefined,
        query: this.isObjectRecord(input.query) ? input.query : undefined,
        body: input.body,
        headers: this.normalizeHeaders(input.headers ?? input.header),
        isStructured: true,
      };
    }

    return {
      body: input,
      headers: {},
      isStructured: false,
    };
  }

  private isStructuredRequestInput(
    input: unknown,
  ): input is Record<string, any> {
    if (!this.isObjectRecord(input)) return false;

    const keys = Object.keys(input);
    if (keys.length === 0) return false;

    return (
      keys.some((key) => REQUEST_PART_KEYS.has(key)) &&
      keys.every((key) => REQUEST_PART_KEYS.has(key))
    );
  }

  private isObjectRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private applyPathParams(
    fullUrl: string,
    pathParams?: Record<string, any>,
  ): string {
    const url = new URL(fullUrl);

    const replacedPathname = url.pathname.replace(
      /:([A-Za-z0-9_]+)/g,
      (_, key: string) => {
        const value = pathParams?.[key];

        if (value === undefined || value === null) {
          throw this.createError({
            message: `Missing path param "${key}"`,
            code: "MISSING_PATH_PARAM",
          });
        }

        return encodeURIComponent(String(value));
      },
    );

    return `${url.origin}${replacedPathname}${url.search}${url.hash}`;
  }

  private appendQueryParams(url: string, query?: Record<string, any>): string {
    if (!query) return url;

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      this.appendQueryValue(params, key, value);
    }

    const queryString = params.toString();
    if (!queryString) return url;

    return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
  }

  private appendQueryValue(params: URLSearchParams, key: string, value: any) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      for (const item of value) this.appendQueryValue(params, key, item);
      return;
    }

    if (value instanceof Date) {
      params.append(key, value.toISOString());
      return;
    }

    if (typeof value === "object") {
      params.append(key, JSON.stringify(value));
      return;
    }

    params.append(key, String(value));
  }

  private appendFormValue(form: FormData, key: string, value: any) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      for (const item of value) this.appendFormValue(form, key, item);
      return;
    }

    if (value instanceof Date) {
      form.append(key, value.toISOString());
      return;
    }

    const isBlob = typeof Blob !== "undefined" && value instanceof Blob;

    if (typeof value === "object" && !isBlob) {
      form.append(key, JSON.stringify(value));
      return;
    }

    form.append(key, value as any);
  }

  private normalizeHeaders(headers: unknown): Record<string, string> {
    if (!this.isObjectRecord(headers)) return {};

    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) continue;
      normalized[key] = String(value);
    }

    return normalized;
  }

  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    if (err instanceof z.ZodError) {
      return this.createError({
        message: `Validation error: ${err.issues.map((e) => e.message).join(", ")}`,
        code: "VALIDATION_ERROR",
      });
    }
    return this.createError({ message: err.message || "Unknown error" });
  }

  private async handleMockRequest(endpoint: any) {
    const delay =
      Math.floor(
        Math.random() * (this.mockDelay.max - this.mockDelay.min + 1),
      ) + this.mockDelay.min;

    await new Promise((r) => setTimeout(r, delay));

    const data =
      typeof endpoint.mockData === "function"
        ? endpoint.mockData()
        : endpoint.mockData;

    return this.responseTransform(endpoint.response.parse(data));
  }
}
