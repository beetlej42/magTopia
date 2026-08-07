export class ServiceError extends Error {
  constructor(statusCode, code, message, details = {}, retryable = false) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function errorEnvelope(error, requestId = null) {
  return {
    type: "https://magtopia.example/errors/service-error",
    code: error.code ?? "INTERNAL_ERROR",
    message: error.statusCode ? error.message : "An internal error occurred",
    retryable: Boolean(error.retryable),
    details: error.statusCode ? error.details ?? {} : {},
    request_id: requestId
  };
}
