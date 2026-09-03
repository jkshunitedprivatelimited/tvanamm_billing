# Advanced Login and Access Architecture

## Purpose

Billing will use one identity platform with different experiences for office
administrators and store operators. Authentication, authorization, workstation
access, shifts, and approvals are separate concepts with separate records.

## Login Surfaces

### Admin Login

Route: `/admin/login`

For Central Admin, Accountant, and Franchise Owner users.

- Mobile number plus SMS OTP.
- No additional MFA factor for the MVP.
- Passkey support may remain possible later but is not an MVP dependency.
- Risk-based challenges for new devices or unusual access.
- Membership/workspace selection after authentication.
- Step-up authentication for destructive or financial administration.

SMS OTP is the confirmed primary authentication method for all Admin-app actors.

### Store Terminal Login

Route: `/store/login`

Store access is a two-stage flow:

1. Register and authorize the physical terminal.
2. Authenticate the employee operating the terminal.

A Store Employee PIN alone must never authenticate an unregistered remote browser.

- A Franchise Owner authenticates on a new device and explicitly registers it to
  one owned outlet before Store Employee PIN login is enabled.
- The MVP permits one active Billing terminal per outlet. Registering a
  replacement revokes the previous terminal. The data model uses terminal records
  rather than hard-coded single-device fields so multi-terminal support can be
  added later without a schema redesign.
- The server issues a revocable terminal credential.
- A registered terminal is assigned to an organization, franchise, and store.
- Each Store Employee is assigned to one outlet and can enter one short personal
  PIN on a registered terminal belonging to that outlet.
- Store Employees do not select outlets or maintain separate outlet codes.
- Sensitive owner/internal actions can require a fresh SMS OTP session.
- Terminal lock preserves the workstation and shift state without exposing POS
  data.
- Terminal deactivation immediately blocks new operations.

## Four Independent State Machines

### 1. Account state

```text
invited -> active -> suspended -> active
                  -> disabled
                  -> locked -> active
```

### 2. Authentication session

```text
created -> active -> expired
                  -> revoked
                  -> step-up-required -> active
```

### 3. Terminal state

```text
pending -> active -> locked -> active
                  -> revoked
```

### 4. Shift state

```text
draft -> open -> closing -> closed
             -> force-closed
```

Logging out ends the authentication session. It does not silently edit attendance
or financial shift records. Closing a shift is a separate audited command.

## Identity and Tenant Model

### Core records

- `users`: identity and account lifecycle.
- `organizations`: top-level company boundary.
- `franchises`: business ownership boundary.
- `stores`: physical billing location.
- `memberships`: connects users to a scope and role.
- `roles`: named responsibility bundles.
- `permissions`: granular capabilities.
- `role_permissions`: role-to-capability assignments.
- `terminals`: registered store devices.
- `terminal_credentials`: hashed/revocable terminal credentials.
- `sessions`: application sessions and revocation state.
- `shifts`: Store Employee operating sessions.
- `auth_audit_events`: immutable security activity.

One user may have multiple memberships. Role is never stored as a single mutable
browser-controlled string.

Example memberships:

- Central administrator across an organization.
- Franchise owner across their franchise.
- Store Employee for one outlet.
- Cashier for one store.
- Auditor with read-only access for a date range.

## Authorization

Authorization uses capability plus resource scope:

```text
allow when
  session is active
  AND account is active
  AND membership includes requested organization/franchise/store
  AND role grants the capability
  AND contextual policy is satisfied
```

Contextual policies can require:

- an open shift;
- the registered terminal's store matching the bill's store;
- a recent authenticated session;
- an online connection for authoritative refund/adjustment checks;
- a maximum discount/refund amount;
- permitted operating hours.

The API derives organization, franchise, store, role, and permissions from the
validated session. It never accepts those values from the browser as proof.

## Authentication Methods

### Required for MVP

- Mobile-number SMS OTP for Central Admin, Accountant, and Franchise Owner.
- Hashed store quick PIN after full initial employee authentication.
- Secure one-time invitation links.

### Designed for later addition

- Passkeys/WebAuthn.
- Enterprise SSO.
- Email OTP as a fallback, not the primary administrator factor.
- Biometric unlock through platform passkeys.

No plaintext password or PIN is stored, logged, emailed, or returned by an API.

## Confirmed Mobile Identity Rules

- SMS is the MVP OTP delivery channel.
- Central Admin, Accountant, and Franchise Owner authenticate using mobile OTP.
- Additional TOTP/passkey MFA is not required for the MVP.
- One mobile number identifies one human account so OTP resolution is
  deterministic and auditable.
- One internal JKSH account may receive both `central_admin` and `accountant`
  capabilities when the same person performs both responsibilities.
- Different internal people should use separate mobile numbers and accounts.
- Each Franchise Owner uses a distinct mobile identity.
- One Franchise Owner account may hold memberships for multiple outlets and sees
  outlet selection cards after login.
- Role and outlet access come from server-side memberships, not from the phone
  number or OTP payload.
- SMS resend cooldown, attempt limits, temporary lockout, session revocation, and
  login alerts compensate for the MVP's lack of a second factor.

## Confirmed Franchise Onboarding

1. Central Admin creates the Franchise Owner account and assigns its brand,
   franchise, and initial outlet memberships.
2. Public self-registration is disabled.
3. The system sends a one-time invitation to the owner's verified contact.
4. The owner opens the invitation and verifies the registered mobile number using
   OTP.
5. The owner accepts terms and enters the authorized outlet-card workspace.
6. Invitation tokens are single-use, expire, and never contain authorization
   data trusted without server validation.
7. Creation, delivery, acceptance, expiry, cancellation, and resend are audited.

## Confirmed Employee Provisioning

1. Franchise Owner creates an employee with name and mobile number.
2. The system generates the employee ID and binds the employee to one outlet.
3. Franchise Owner assigns the initial four-digit PIN.
4. The API validates outlet-local PIN uniqueness and stores only a strong hash.
5. The plaintext PIN is never retrievable after creation.
6. Franchise Owner can perform an audited PIN reset when required.
7. Franchise Owner can create, disable, reactivate, and reset PINs only for Store
   Employees assigned to owned outlets, without Central involvement.

## Token and Session Design

- Short-lived access token.
- Rotating refresh token.
- Server-side session record with immediate revocation support.
- HTTP-only, Secure, SameSite cookies for web sessions where architecture allows.
- CSRF protection for cookie-authenticated mutations.
- Unique session ID and device ID.
- Idle timeout and absolute timeout.
- Shorter timeout for privileged administration.
- Session list showing device, time, and approximate location.
- `Log out this device` and `Log out all devices`.
- Account disable and permission changes revoke affected sessions.
- Tokens contain stable identifiers, not trusted mutable display/profile fields.

## Store Terminal Security

- Generate a terminal ID during Franchise Owner-controlled enrollment.
- Store terminal secrets using browser platform security where available.
- Store only credential hashes server-side.
- Bind operations to registered terminal, store, user, and open shift.
- Rotate terminal credentials.
- Allow remote terminal revocation.
- Record terminal application version and last-seen time.
- Detect cloned credentials and conflicting terminal activity.
- Do not use browser fingerprinting as the primary security control.
- Provide a deliberate terminal transfer/re-enrollment workflow.

## Fast Cashier Switching

1. Manager enrolls and unlocks the terminal.
2. Cashier selects their profile or enters employee ID.
3. Cashier enters quick PIN.
4. Server validates terminal, employee membership, account state, and PIN.
5. Store Employee opens or resumes an allowed shift.
6. POS receives a short-lived operator context.

Switching employee locks the previous operator context. It never reuses the
previous employee's permissions.

## Fresh Authentication for Sensitive Administration

Sensitive Admin/Owner capabilities can require a fresh SMS OTP session:

- reopening a closed shift;
- exporting customer or financial data;
- changing roles or permissions;
- employee PIN reset;
- terminal registration or revocation.

Store Employee same-day refunds follow the confirmed refund policy and do not
require approval. Franchise Owner historical refunds require an online, fresh
owner session and remain scoped to owned outlets.

## Security Controls

- Rate-limit by account, IP, device, and terminal.
- Progressive delays and temporary account locks.
- CAPTCHA only after suspicious public login behavior.
- Generic login errors to prevent account enumeration.
- OTP replay protection and mobile-change notifications.
- Cryptographically secure tokens and PIN reset codes.
- Input validation and strict request limits.
- Secure headers, origin checks, and CSRF defense.
- Secret rotation and environment separation.
- Alerts for repeated failures, new admin devices, mobile changes, mass exports,
  privilege changes, and terminal cloning indicators.

## Audit Events

Record at minimum:

- login success/failure;
- logout and session expiry/revocation;
- mobile OTP challenge and mobile-number change;
- employee PIN creation and reset;
- membership/role/permission changes;
- workspace selection;
- terminal enrollment, lock, unlock, and revocation;
- shift open, close, and force-close;
- step-up success/failure;
- disabled-account access attempts.

Audit entries include actor, subject, action, result, timestamp, session, terminal,
scope, correlation ID, and safe metadata. They never include passwords, PINs,
tokens, or full sensitive request bodies.

## Recovery and Exceptional Access

- Recovery cannot rely on an administrator assigning a reusable OTP or PIN.
- Mobile-number changes require a separate authorized workflow and notify the
  old and new numbers where possible.
- Maintain tightly controlled break-glass accounts for outages.
- Break-glass access uses a separately controlled recovery process, creates
  high-priority alerts, and is reviewed.
- Define an offline terminal policy separately; offline authentication materially
  changes the threat model and must not be added accidentally.

## Required Tests

- Cross-franchise and cross-store access denial.
- Store credentials rejected from unregistered terminals.
- Cashier PIN rejected without valid terminal context.
- Disabled user and revoked terminal denied immediately.
- Expired/revoked sessions denied.
- Refresh-token reuse detection.
- Fresh OTP sessions enforced where policy requires reauthentication.
- Store Employee switching cannot inherit the previous operator's permissions.
- Logout, terminal lock, and shift close produce different correct outcomes.
- Brute-force throttling and account-enumeration protection.
- Audit events emitted for success and failure paths.

## Implementation Sequence

1. Approve actor, membership, capability, and scope model.
2. Implement confirmed owner-controlled terminal registration and employee PIN
   provisioning behavior.
3. Implement confirmed SMS OTP, timeout, throttling, and recovery policies.
4. Implement database migrations and authorization test fixtures.
5. Implement Identity API and session middleware.
6. Implement Admin mobile OTP login.
7. Implement terminal enrollment and Store login.
8. Implement shift session and terminal lock/unlock.
9. Implement fresh-OTP checks for sensitive Owner/Admin actions.
10. Integrate the Billing API only after authorization tests pass.
