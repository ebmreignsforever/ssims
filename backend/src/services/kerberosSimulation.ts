import crypto from 'node:crypto';
import { config } from '../config';
import { hmacSha256 } from '../utils/crypto';

/**
 * ============================================================================
 * SIMULATED Kerberos v5 authentication exchange
 * ============================================================================
 * This is NOT a Kerberos implementation and does not interoperate with a KDC.
 * It models the protocol messages of a centralized authentication service so
 * the project can demonstrate:
 *   - Authentication Server (AS) exchange and pre-authentication
 *   - Ticket Granting Ticket (TGT)
 *   - Ticket Granting Service (TGS) exchange
 *   - Service ticket and AP exchange
 *   - Mutual authentication
 *   - Timestamp/replay rejection
 *
 * Tickets and authenticators are encrypted with AES-256-GCM using keys derived
 * from a local demonstration master key. A production deployment would use a
 * real KDC (MIT krb5, Active Directory) over trusted time and network services.
 */

export interface KerberosStep {
  step: number;
  phase: string;
  from: string;
  to: string;
  title: string;
  detail: string;
  validation?: string;
  ticketPreview?: string;
  keyFingerprint?: string;
}

export interface KerberosResult {
  simulation: true;
  notice: string;
  realm: string;
  client: string;
  service: string;
  steps: KerberosStep[];
  checks: {
    preAuthentication: boolean;
    tgtIssued: boolean;
    serviceTicketIssued: boolean;
    authenticatorFresh: boolean;
    mutualAuthentication: boolean;
    replayRejected: boolean;
  };
  result: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
  limitations: string[];
}

interface TicketGrant {
  client: string;
  realm: string;
  service: string;
  sessionKey: string;
  issuedAt: number;
  expiresAt: number;
  flags: string[];
}

const REALM = 'SSIMS.EDU';
const CLIENT = `student@${REALM}`;
const TGS_PRINCIPAL = `krbtgt/${REALM}@${REALM}`;
const SERVICE = `fileserver/ssims.edu@${REALM}`;
const CLOCK_SKEW_SECONDS = 300;
const TICKET_LIFETIME_SECONDS = 300;

function deriveKey(purpose: string): Buffer {
  // HKDF-like derivation with a dedicated context string for each principal.
  return crypto.createHmac('sha256', config.challengeSecret).update(`ssims-kerberos-simulation:${purpose}`).digest();
}

function fingerprint(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function seal(key: Buffer, value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function open<T>(key: Buffer, sealed: string): T {
  const raw = Buffer.from(sealed, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
}

function preview(value: string): string {
  return `${value.slice(0, 22)}…${value.slice(-10)} (${value.length} chars)`;
}

const replayCache = new Set<string>();

export function runKerberosSimulation(): KerberosResult {
  // Bound the process-local replay cache so repeated authorized demonstrations
  // cannot grow memory without limit.
  if (replayCache.size > 10_000) replayCache.clear();
  const startedAt = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const steps: KerberosStep[] = [];

  const clientKey = deriveKey(`client:${CLIENT}`);
  const tgsKey = deriveKey(`tgs:${TGS_PRINCIPAL}`);
  const serviceKey = deriveKey(`service:${SERVICE}`);

  // 1. AS exchange with pre-authentication. The client proves knowledge of its
  // long-term key by encrypting a timestamp. The password is never transmitted.
  const preAuthTimestamp = now;
  const preAuth = seal(clientKey, { client: CLIENT, timestamp: preAuthTimestamp, nonce: crypto.randomUUID() });
  const asDecrypted = open<{ client: string; timestamp: number; nonce: string }>(clientKey, preAuth);
  const preAuthentication = asDecrypted.client === CLIENT && Math.abs(now - asDecrypted.timestamp) <= CLOCK_SKEW_SECONDS;

  const tgsSessionKey = crypto.randomBytes(32).toString('base64url');
  const tgt: TicketGrant = {
    client: CLIENT,
    realm: REALM,
    service: TGS_PRINCIPAL,
    sessionKey: tgsSessionKey,
    issuedAt: now,
    expiresAt: now + TICKET_LIFETIME_SECONDS,
    flags: ['forwardable', 'renewable', 'pre-authenticated'],
  };
  const encryptedTgt = seal(tgsKey, tgt);
  const asReplyForClient = seal(clientKey, {
    client: CLIENT,
    tgs: TGS_PRINCIPAL,
    sessionKey: tgsSessionKey,
    expiresAt: tgt.expiresAt,
    tgt: encryptedTgt,
  });

  steps.push({
    step: 1,
    phase: 'AS Exchange',
    from: CLIENT,
    to: `krbtgt/${REALM}`,
    title: 'AS-REQ with pre-authentication',
    detail:
      'The client encrypts a timestamp with its long-term key. The Authentication Server decrypts it to prove the client knows the credential without sending a password.',
    validation: preAuthentication ? 'Pre-authentication timestamp valid' : 'Pre-authentication failed',
    ticketPreview: preview(preAuth),
    keyFingerprint: fingerprint(clientKey),
  });

  // 2. AS_REP. The TGT is encrypted with the TGS long-term key. Only the TGS can
  // read it; the client receives an opaque ticket plus a session key protected
  // by the client's key.
  const asReply = open<{
    client: string;
    tgs: string;
    sessionKey: string;
    expiresAt: number;
    tgt: string;
  }>(clientKey, asReplyForClient);
  const tgtIssued = asReply.tgt === encryptedTgt && asReply.expiresAt > now;

  steps.push({
    step: 2,
    phase: 'AS Exchange',
    from: `krbtgt/${REALM}`,
    to: CLIENT,
    title: 'AS-REP: Ticket Granting Ticket issued',
    detail:
      'The AS returns a TGT encrypted with the TGS key, plus a client/TGS session key encrypted under the client key. The client cannot read or modify the TGT.',
    validation: tgtIssued ? 'TGT decryptable and unexpired; session key delivered confidentially' : 'TGT validation failed',
    ticketPreview: preview(encryptedTgt),
    keyFingerprint: fingerprint(tgsKey),
  });

  // 3. TGS_REQ. Client presents the TGT and an authenticator encrypted with the
  // client/TGS session key. Timestamp and replay checks mimic KDC behaviour.
  const tgsTicket = open<TicketGrant>(tgsKey, asReply.tgt);
  const tgsAuthenticator = seal(Buffer.from(asReply.sessionKey, 'base64url'), {
    client: CLIENT,
    timestamp: now,
    nonce: crypto.randomUUID(),
  });
  const tgsAuthenticatorSeen = replayCache.has(tgsAuthenticator);
  replayCache.add(tgsAuthenticator);
  const tgsAuthenticatorData = open<{ client: string; timestamp: number; nonce: string }>(
    Buffer.from(asReply.sessionKey, 'base64url'),
    tgsAuthenticator,
  );
  const authenticatorFresh =
    !tgsAuthenticatorSeen &&
    tgsAuthenticatorData.client === CLIENT &&
    Math.abs(now - tgsAuthenticatorData.timestamp) <= CLOCK_SKEW_SECONDS;

  steps.push({
    step: 3,
    phase: 'TGS Exchange',
    from: CLIENT,
    to: TGS_PRINCIPAL,
    title: 'TGS-REQ: present TGT and authenticator',
    detail:
      'The client sends the opaque TGT for the file service plus a fresh authenticator encrypted with the client/TGS session key. The TGS checks ticket validity, timestamp and replay.',
    validation: authenticatorFresh ? 'TGT decrypted; authenticator fresh and not replayed' : 'TGS request rejected',
    ticketPreview: preview(tgsAuthenticator),
    keyFingerprint: fingerprint(Buffer.from(asReply.sessionKey, 'base64url')),
  });

  // 4. TGS_REP. Service ticket encrypted with the service's long-term key.
  const serviceSessionKey = crypto.randomBytes(32).toString('base64url');
  const serviceTicket: TicketGrant = {
    client: CLIENT,
    realm: REALM,
    service: SERVICE,
    sessionKey: serviceSessionKey,
    issuedAt: now,
    expiresAt: now + TICKET_LIFETIME_SECONDS,
    flags: ['pre-authenticated'],
  };
  const encryptedServiceTicket = seal(serviceKey, serviceTicket);
  const tgsReply = seal(Buffer.from(tgsTicket.sessionKey, 'base64url'), {
    serviceTicket: encryptedServiceTicket,
    serviceSessionKey,
    expiresAt: serviceTicket.expiresAt,
  });
  const tgsReplyData = open<{ serviceTicket: string; serviceSessionKey: string }>(
    Buffer.from(tgsTicket.sessionKey, 'base64url'),
    tgsReply,
  );
  const serviceTicketIssued = tgsReplyData.serviceTicket === encryptedServiceTicket;

  steps.push({
    step: 4,
    phase: 'TGS Exchange',
    from: TGS_PRINCIPAL,
    to: CLIENT,
    title: 'TGS-REP: service ticket issued',
    detail:
      'The TGS issues a service ticket encrypted with the file server key and returns a client/service session key protected by the client/TGS session key.',
    validation: serviceTicketIssued ? 'Service ticket delivered; client session key rotated' : 'Service ticket validation failed',
    ticketPreview: preview(encryptedServiceTicket),
    keyFingerprint: fingerprint(serviceKey),
  });

  // 5. AP_REQ and mutual authentication.
  const decodedServiceTicket = open<TicketGrant>(serviceKey, tgsReplyData.serviceTicket);
  const apAuthenticator = seal(Buffer.from(decodedServiceTicket.sessionKey, 'base64url'), {
    client: CLIENT,
    timestamp: now,
    nonce: crypto.randomUUID(),
  });
  const apAuthenticatorSeen = replayCache.has(apAuthenticator);
  replayCache.add(apAuthenticator);
  const apAuthenticatorData = open<{ client: string; timestamp: number; nonce: string }>(
    Buffer.from(decodedServiceTicket.sessionKey, 'base64url'),
    apAuthenticator,
  );
  const apFresh =
    !apAuthenticatorSeen &&
    apAuthenticatorData.client === CLIENT &&
    Math.abs(now - apAuthenticatorData.timestamp) <= CLOCK_SKEW_SECONDS;

  const mutualReply = seal(Buffer.from(decodedServiceTicket.sessionKey, 'base64url'), {
    timestamp: apAuthenticatorData.timestamp + 1,
    service: SERVICE,
  });
  const mutualData = open<{ timestamp: number; service: string }>(
    Buffer.from(decodedServiceTicket.sessionKey, 'base64url'),
    mutualReply,
  );
  const mutualAuthentication =
    mutualData.timestamp === apAuthenticatorData.timestamp + 1 && mutualData.service === SERVICE;

  steps.push({
    step: 5,
    phase: 'AP Exchange',
    from: CLIENT,
    to: SERVICE,
    title: 'AP-REQ: access the file service',
    detail:
      'The client presents the service ticket and an authenticator encrypted with the client/service session key. The service validates the ticket and authenticator.',
    validation: apFresh ? 'Service ticket decrypted; authenticator accepted' : 'Service rejected the authenticator',
    ticketPreview: preview(apAuthenticator),
    keyFingerprint: fingerprint(Buffer.from(decodedServiceTicket.sessionKey, 'base64url')),
  });

  steps.push({
    step: 6,
    phase: 'Mutual Authentication',
    from: SERVICE,
    to: CLIENT,
    title: 'AP-REP: server proves its identity',
    detail:
      'The service returns the client timestamp + 1 encrypted with the session key. Only the genuine service could produce this response, so the client authenticates the server too.',
    validation: mutualAuthentication ? 'Mutual authentication confirmed' : 'Mutual authentication failed',
    ticketPreview: preview(mutualReply),
    keyFingerprint: fingerprint(Buffer.from(decodedServiceTicket.sessionKey, 'base64url')),
  });

  // 6. Replay demonstration: re-present the exact same authenticator.
  let replayRejected = false;
  try {
    if (replayCache.has(apAuthenticator)) {
      throw new Error('Replay detected: authenticator nonce already observed');
    }
  } catch {
    replayRejected = true;
  }

  steps.push({
    step: 7,
    phase: 'Replay Defence',
    from: CLIENT,
    to: SERVICE,
    title: 'Replayed AP-REQ is rejected',
    detail:
      'The laboratory re-presents the exact authenticator captured above. The service replay cache recognizes it and refuses the request, demonstrating why fresh timestamps and nonces matter.',
    validation: replayRejected ? 'Replay rejected as expected' : 'Replay unexpectedly accepted',
  });

  const checks = {
    preAuthentication,
    tgtIssued,
    serviceTicketIssued,
    authenticatorFresh,
    mutualAuthentication,
    replayRejected,
  };
  const result = Object.values(checks).every(Boolean) ? 'passed' : 'failed';

  return {
    simulation: true,
    notice:
      'SIMULATION ONLY: this educational model does not contact a KDC and is not wire-compatible with Kerberos. Real Kerberos requires a KDC, synchronized clocks, service principals and keytabs.',
    realm: REALM,
    client: CLIENT,
    service: SERVICE,
    steps,
    checks,
    result,
    startedAt,
    completedAt: new Date().toISOString(),
    limitations: [
      'No real KDC, AS-REQ/UDP/TCP wire protocol, or keytab integration.',
      'Long-term keys are derived from a local simulation secret, not a directory password.',
      'The replay cache is per-process and in-memory; real KDCs persist replay state.',
      'Production SSO would use MIT Kerberos or Active Directory with SPNEGO, DNS, NTP and TLS-protected fallback.',
    ],
  };
}

export function kerberosSimulationMarker(): string {
  return hmacSha256(config.challengeSecret, 'kerberos-simulation-enabled').slice(0, 16);
}
