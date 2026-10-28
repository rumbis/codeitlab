/**
 * Every failure the HTTP layer can produce is an `HttpError`: the router maps it
 * to `{ error, message }` (JSON) or an error page, so route code never has to
 * know how it is rendered.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = "bad_request"): HttpError =>
  new HttpError(400, code, message);

export const unauthorized = (message = "Sign in to continue.", code = "unauthorized"): HttpError =>
  new HttpError(401, code, message);

export const forbidden = (message: string, code = "forbidden"): HttpError =>
  new HttpError(403, code, message);

export const notFound = (message = "Not found.", code = "not_found"): HttpError =>
  new HttpError(404, code, message);

export const conflict = (message: string, code = "conflict"): HttpError =>
  new HttpError(409, code, message);

export const tooManyRequests = (message: string, code = "rate_limited"): HttpError =>
  new HttpError(429, code, message);
