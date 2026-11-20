/** Error with an HTTP status that is safe to show to the client. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "ERROR",
    public fieldErrors?: Record<string, string>,
    /** Extra response headers, e.g. Retry-After on 429. */
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(400, message, "BAD_REQUEST", fieldErrors);
export const unauthorized = (message = "You must be signed in.") => new ApiError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new ApiError(403, message, "FORBIDDEN");
export const notFound = (entity = "Record") => new ApiError(404, `${entity} not found.`, "NOT_FOUND");
export const conflict = (message: string, fieldErrors?: Record<string, string>) =>
  new ApiError(409, message, "CONFLICT", fieldErrors);

export const tooMany = (retryAfterMs: number, message = "Too many attempts. Please wait and try again.") =>
  new ApiError(429, message, "RATE_LIMITED", undefined, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });
