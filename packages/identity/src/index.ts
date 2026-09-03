export type {
  ActorContext,
  AccessScope,
  Membership,
  MembershipRole,
  Role,
  Capability,
  WorkspaceCard,
  AccountStatus,
  EmployeeStatus,
} from '@jksh/contracts';

export * from './errors.js';
export * from './authorize.js';
export { ensureAllowed } from './authz.js';
export * from './membership.js';
export {
  isValidPinFormat,
  isWeakPin,
  hashPin,
  verifyPinHash,
  pinLookup,
  pinLookupEquals,
  attemptGate,
  registerFailure,
  registerSuccess,
  isHardLocked,
  DEFAULT_LOCKOUT_POLICY,
  EMPTY_ATTEMPT_STATE,
  PIN_PATTERN,
  type AttemptState,
  type AttemptGate,
  type LockoutPolicy,
} from './pin.js';
export {
  otpSendGate,
  otpVerifyGate,
  registerOtpSend,
  registerOtpVerifyFailure,
  resetOtpState,
  DEFAULT_OTP_POLICY,
  EMPTY_OTP_STATE,
  type OtpAttemptState,
  type OtpPolicy,
  type OtpGate,
} from './otp.js';
export {
  checkAndRecordOtpSend,
  checkOtpVerify,
  recordOtpVerifyFailure,
  resetOtpAttempts,
  type OtpGateResult,
} from './otp-attempts.js';
export * from './ids.js';
export {
  mintTerminalCredential,
  parseTerminalCredential,
  mintOperatorToken,
  parseOperatorToken,
  nonceHashMatches,
  hashActivationCode,
  activationCodeMatches,
  mintInvitationToken,
  hashInvitationToken,
  sha256Hex,
  type MintedCredential,
  type ParsedCredential,
  type MintedOperatorToken,
  type ParsedOperatorToken,
} from './tokens.js';
export { recordAudit, type AuditInput } from './audit.js';
export {
  getSmsSender,
  setSmsSender,
  Msg91SmsSender,
  LogSmsSender,
  toMsg91Mobile,
  type SmsSender,
  type SmsSendResult,
  type Msg91Config,
} from './sms-sender.js';
export { systemContext, contextForActor } from './db-context.js';
export {
  resolveAdminAfterVerify,
  listWorkspaceCards,
  selectWorkspace,
  buildAdminActor,
  recordAdminLogout,
  type RequestMeta,
  type ResolvedWorkspace,
  type AdminActorInput,
} from './admin-auth.js';
export { setAccountStatus } from './account.js';
export {
  createFranchiseOwnerInvitation,
  acceptInvitation,
} from './invitations.js';
export {
  createOutlet,
  outletLifecycle,
  updateOutletConfig,
  listOutlets,
} from './outlet.js';
export {
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  resetEmployeePin,
  listEmployees,
} from './employee.js';
export {
  issueActivationCode,
  registerTerminal,
  listTerminals,
  revokeTerminal,
} from './terminal.js';
export {
  pinLogin,
  loadOperatorContext,
  lockOperator,
  endOperatorSession,
  type PinLoginOutput,
} from './store-auth.js';
