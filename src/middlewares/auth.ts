import { Middleware } from "../types";

export type AuthOptions = {
  refreshToken?: () => Promise<string>;
};

export const authMiddleware: Middleware<AuthOptions> = async (ctx, next, options) => {
  if (options?.refreshToken) {
    try {
      const newToken = await options.refreshToken();
      ctx.init.headers = {
        ...ctx.init.headers,
        Authorization: `Bearer ${newToken}`
      };
    } catch {}
  }

  return next();
};
