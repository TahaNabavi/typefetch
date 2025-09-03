import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  Middleware,
  ErrorLike,
  EndpointMethods,
} from "./types";
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

  private _modules!: {
    [M in keyof C]: EndpointMethods<C[M]>;
  };

  constructor(
    private config: { baseUrl: string; token?: string },
    private contracts: C
  ) {}

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

  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>
  ): Promise<z.infer<TRes>> {
    endpoint.request.parse(input);

    if (endpoint.auth && !this.config.token) {
      const error = this.createError({
        message: `Missing token for ${endpoint.path}`,
        status: 401,
        code: "NO_TOKEN",
      });
      this.errorHandler?.(error as unknown as E);
      throw error;
    }

    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (endpoint.auth && this.config.token)
      headers["Authorization"] = `Bearer ${this.config.token}`;

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
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const error = this.createError({
          message: errorData.message || res.statusText,
          status: res.status,
          code: errorData.code,
          title: errorData.title,
          detail: errorData.detail,
          errors: errorData.errors,
        });
        this.errorHandler?.(error as unknown as E);
        throw error;
      }

      const json = await res.json();
      return this.responseTransform(endpoint.response.parse(json));
    } catch (err: any) {
      const error = this.normalizeError(err);
      this.errorHandler?.(error as unknown as E);
      throw error;
    }
  }

  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    return this.createError({ message: err.message || "Unknown error" });
  }
}
