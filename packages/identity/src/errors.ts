/** Stable error codes returned to the UI. Messages are safe to surface. */
export type IdentityErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'account_disabled'
  | 'account_locked'
  | 'session_expired'
  | 'session_not_found'
  | 'invalid_credentials'
  | 'invalid_pin'
  | 'pin_locked'
  | 'pin_not_unique'
  | 'terminal_not_found'
  | 'terminal_revoked'
  | 'terminal_already_registered'
  | 'activation_code_invalid'
  | 'activation_code_expired'
  | 'activation_code_consumed'
  | 'outlet_capacity'
  | 'employee_exists'
  | 'not_found'
  | 'conflict'
  | 'validation';

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: IdentityErrorCode,
    message: string,
    options?: { httpStatus?: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.httpStatus = options?.httpStatus ?? defaultStatus(code);
    this.details = options?.details;
  }
}

function defaultStatus(code: IdentityErrorCode): number {
  switch (code) {
    case 'unauthenticated':
    case 'session_expired':
    case 'session_not_found':
      return 401;
    case 'forbidden':
    case 'account_disabled':
    case 'account_locked':
    case 'terminal_revoked':
      return 403;
    case 'not_found':
    case 'terminal_not_found':
      return 404;
    case 'conflict':
    case 'employee_exists':
    case 'terminal_already_registered':
    case 'activation_code_consumed':
    case 'pin_not_unique':
      return 409;
    case 'pin_locked':
      return 429;
    default:
      return 400;
  }
}
