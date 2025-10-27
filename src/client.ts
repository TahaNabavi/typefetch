import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  Middleware,
  ErrorLike,
  EndpointMethods,
  TokenProvider,
} from "@/types";
import { z } from "zod";

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
        ) => this.request(endpoint, input);
      }
    }

    this._modules = modules;
  }

  get modules() {
    return this._modules;
  }

  use<T>(middleware: Middleware<T>, options?: T) {
    this.middlewares.push({ fn: middleware, options });
  }

  onError(handler: (error: E) => void) {
    this.errorHandler = handler;
  }

  useResponseTransform(fn: (data: any) => any) {
    this.responseTransform = fn;
  }

  setMockMode(enabled: boolean, delay?: { min: number; max: number }) {
    this.useMockData = enabled;
    if (delay) {
      this.mockDelay = delay;
    }
  }

  setResponseWrapper(wrapper: (successResponse: z.ZodTypeAny) => z.ZodTypeAny) {
    this.responseWrapper = wrapper;
  }

  setTokenProvider(provider: TokenProvider) {
    this.tokenProvider = provider;
  }

  async getCurrentToken(): Promise<string | undefined> {
    if (this.tokenProvider) {
      return await this.tokenProvider();
    }
    return this.config.token;
  }

  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>
  ): Promise<z.infer<TRes>> {
    endpoint.request.parse(input);

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

    const ctx = {
      url: this.config.baseUrl + endpoint.path,
      init: {
        method: endpoint.method,
        headers,
        body: endpoint.method !== "GET" ? JSON.stringify(input) : undefined,
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

  private getRandomDelay(): number {
    return (
      Math.floor(
        Math.random() * (this.mockDelay.max - this.mockDelay.min + 1)
      ) + this.mockDelay.min
    );
  }

  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

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
