export type StockErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'insufficient_stock'
  | 'payment_unverified'
  | 'signature_invalid'
  | 'already_processed'
  | 'recall_blocked'
  | 'immutable';

export class StockError extends Error {
  readonly code: StockErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: StockErrorCode,
    message: string,
    options?: { httpStatus?: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'StockError';
    this.code = code;
    this.httpStatus = options?.httpStatus ?? defaultStatus(code);
    this.details = options?.details;
  }
}

function defaultStatus(code: StockErrorCode): number {
  switch (code) {
    case 'unauthenticated':
      return 401;
    case 'forbidden':
    case 'payment_unverified':
    case 'recall_blocked':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'already_processed':
    case 'immutable':
      return 409;
    case 'signature_invalid':
      return 400;
    default:
      return 400;
  }
}
