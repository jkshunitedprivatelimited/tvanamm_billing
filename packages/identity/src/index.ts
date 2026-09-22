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
export { checkDatabaseHealth } from './health';
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
  pauseOutletItem,
  linkStockRecipe,
  listMasterMenu,
  listOutletMenuForPricing,
  type LinkStockRecipeCommand,
  type MasterMenuView,
  type OutletMenuPricingView,
} from './catalog';
export { createTaxProfile, updateTaxProfile, listTaxProfiles } from './tax-profile';
export { createCombo, updateCombo } from './combo';
export {
  checkIn,
  getOwnOpenAttendance,
  checkOut,
  correctAttendance,
  setOutletSchedule,
  listAttendance,
  getEmployeeActivitySummary,
} from './attendance';
export {
  recordExpense,
  reviewExpense,
  createExpenseCategory,
  setExpenseThreshold,
  getExpenseThreshold,
  listExpenses,
  getExpenseReport,
} from './expense';
export { createOffer, offerLifecycle, listOffers } from './offer';
export {
  emitNotification,
  emitNotificationInTx,
  listNotifications,
  markNotification,
  markAllNotificationsRead,
  setNotificationMute,
  type NotificationInput,
} from './notification';
export { previewImport, confirmImport, getImportJob } from './import';
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
  finishWork,
  getOpenCashSession,
  startShift,
  endShift,
  forceCloseShift,
  getShift,
  listOpenShifts,
  outletBillingWindow,
} from './shifts';
export {
  listOwnerRegisters,
  getOwnerRegisterReview,
  closeOwnerRegister,
  type OwnerRegisterReview,
} from './owner-registers';
export {
  calculateBill,
  type CalcInput,
  type CalcResult,
  type CalcLineInput,
  type CalcDiscount,
} from './bill-calc';
export { createBill, getBill, listBills, formatReceiptNumber, type BillListRow } from './bills';
export { recordOutbox, type OutboxInput } from './audit';
export {
  mintOfflineAuthBundle,
  parseOfflineAuthBundle,
  assertOfflineAuthCovers,
  OFFLINE_AUTH_HOURS,
  DEFAULT_OFFLINE_DISCOUNT_POLICY,
  type OfflineAuthBundle,
  type DiscountPolicy,
} from './offline-auth';
export { issueOfflineAuth, reserveReceiptBlock, syncOfflineBills } from './offline';
export { createRefund, listRefunds } from './refunds';
export { recordPrintAttempt, getReceiptSnapshot } from './receipts';
export {
  getFinancialReport,
  getRefundReasonBreakdown,
  getDiscountReasonBreakdown,
  getEmployeeSalesBreakdown,
  getTopSellingItems,
  listCashSessionsForRange,
  resolveDateRange,
  type ReportRange,
  type ReportRangeKind,
  type ReportFilter,
  type FinancialSummary,
  type ReasonBreakdown,
  type EmployeeSalesRow,
  type TopItemRow,
  type CashSessionRow,
} from './reports';
export {
  getRetentionStatus,
  exportBillsWorkbook,
  workbookToCsv,
  ACTIVE_WINDOW_DAYS,
  type RetentionStatus,
  type ExportBillsCommand,
  type BillsWorkbook,
} from './retention';
export {
  listAuditEvents,
  type AuditQuery,
  type AuditEventView,
  type AuditPage,
} from './audit-read';
export {
  pinLogin,
  recordStaffAttendance,
  listOutletStaff,
  loadOperatorContext,
  lockOperator,
  endOperatorSession,
  rejectOperatorSession,
  getOperatorSummary,
  type PinLoginOutput,
  type OperatorSummary,
} from './store-auth';
export * from './stock-notifications';
export {
  inviteOutletOwner,
  listOutletOnboarding,
  submitOutletOnboarding,
  approveOutletOnboarding,
} from './onboarding';
