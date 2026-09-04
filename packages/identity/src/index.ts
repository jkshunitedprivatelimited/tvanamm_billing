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

export * from './errors';
export * from './authorize';
export { ensureAllowed } from './authz';
export * from './membership';
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
  verifyDummyPin,
  DEFAULT_LOCKOUT_POLICY,
  TERMINAL_LOCKOUT_POLICY,
  EMPTY_ATTEMPT_STATE,
  PIN_PATTERN,
  type AttemptState,
  type AttemptGate,
  type LockoutPolicy,
} from './pin';
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
} from './otp';
export {
  checkAndRecordOtpSend,
  checkOtpVerify,
  recordOtpVerifyFailure,
  resetOtpAttempts,
  type OtpGateResult,
} from './otp-attempts';
export {
  activationClientKey,
  checkActivationGate,
  recordActivationFailure,
  resetActivationAttempts,
  ACTIVATION_LOCKOUT_POLICY,
} from './activation-attempts';
export * from './ids';
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
} from './tokens';
export { recordAudit, type AuditInput } from './audit';
export {
  getSmsSender,
  setSmsSender,
  Msg91SmsSender,
  LogSmsSender,
  toMsg91Mobile,
  type SmsSender,
  type SmsSendResult,
  type Msg91Config,
} from './sms-sender';
export { systemContext, contextForActor } from './db-context';
export {
  resolveAdminAfterVerify,
  eligibleForOtp,
  listWorkspaceCards,
  selectWorkspace,
  buildAdminActor,
  recordAdminLogout,
  type RequestMeta,
  type ResolvedWorkspace,
  type AdminActorInput,
} from './admin-auth';
export { setAccountStatus } from './account';
export { createFranchiseOwnerInvitation, acceptInvitation } from './invitations';
export { createFranchise, listFranchises } from './franchise';
export { createOutlet, outletLifecycle, updateOutletConfig, listOutlets } from './outlet';
export {
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  resetEmployeePin,
  listEmployees,
} from './employee';
export { issueActivationCode, registerTerminal, listTerminals, revokeTerminal } from './terminal';
export {
  createCategory,
  createAddonGroup,
  createCatalogItem,
  updateCatalogItem,
  upsertOutletItemOverride,
  listMasterMenu,
  type MasterMenuView,
} from './catalog';
export {
  previewPublication,
  createAndApplyPublication,
  retryFailedTargets,
  getPublication,
  getPublishedMenu,
  copyOutletItemToMaster,
  type PublicationPreview,
  type PublicationResult,
} from './menu-publish';
export {
  openCashSession,
  closeCashSession,
  getOpenCashSession,
  startShift,
  endShift,
  forceCloseShift,
  getShift,
  listOpenShifts,
  outletBillingWindow,
} from './shifts';
export {
  pinLogin,
  loadOperatorContext,
  lockOperator,
  endOperatorSession,
  rejectOperatorSession,
  getOperatorSummary,
  type PinLoginOutput,
  type OperatorSummary,
} from './store-auth';
