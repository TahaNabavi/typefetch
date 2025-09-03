import { Middleware } from "../types";

export type LoggingOptions = {
  logRequest?: boolean;
  logResponse?: boolean;
  debug?: boolean;
};

export const loggingMiddleware: Middleware<LoggingOptions> = async (ctx, next, options) => {
  const { logRequest = true, logResponse = true, debug = true } = options || {};

  if (debug && logRequest) console.log("➡️ Request:", ctx.url, ctx.init);

  const res = await next();

  if (debug && logResponse) console.log("⬅️ Response:", res.status);

  return res;
};
