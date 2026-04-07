export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApiError(status, code, message) {
  return new ApiError(status, code, message);
}
