# Kerberos Authentication Simulation

## 1. Why Kerberos is included

Kerberos is a centralized network authentication protocol. It allows a user or service to prove its identity once to a Key Distribution Center (KDC) and then obtain service-specific tickets without transmitting a password to each service. It is common in university and enterprise environments (MIT Kerberos, Active Directory, FreeIPA).

The SSIMS academic project cannot operate a full Kerberos realm in its local environment because that would require a KDC, realm configuration, DNS, reliable NTP, service principals, keytabs and wire-level integration with every service. Instead, the project includes a **clearly labelled in-process simulation** that models the authentication exchange and its security properties.

> **SIMULATION ONLY.** The module does not contact a KDC, does not interoperate with MIT krb5 or Active Directory, does not use real user passwords and must not be described as real Kerberos authentication.

The implementation is in:

- `backend/src/services/kerberosSimulation.ts`
- `backend/src/routes/kerberos.ts`
- `frontend/src/pages/admin/KerberosPage.tsx`

---

## 2. Principals used in the simulation

| Principal | Role |
|---|---|
| `student@SSIMS.EDU` | Client principal |
| `krbtgt/SSIMS.EDU@SSIMS.EDU` | TGS principal used to encrypt the TGT |
| `fileserver/ssims.edu@SSIMS.EDU` | Example service principal |
| KDC concept | Authentication Server + Ticket Granting Server |

The simulation derives separate keys for the client, TGS and service from a local secret using domain-separated HMAC derivation. It prints only short key fingerprints; raw keys are not shown.

---

## 3. Protocol steps modelled

### Step 1 — AS-REQ with pre-authentication

The client encrypts a timestamp and nonce with its long-term key. The Authentication Server decrypts it to prove the client knows its credential. A password is **not** sent across the network.

Validation:

- principal matches;
- timestamp is within a 300-second clock skew.

### Step 2 — AS-REP and TGT

The AS creates:

- a client/TGS session key;
- a Ticket Granting Ticket containing the client, realm, TGS principal, session key, issue/expiry times and flags.

The TGT is encrypted with the TGS long-term key, so the client cannot read or modify it. The session key is returned to the client encrypted under the client's long-term key.

Validation:

- TGT is decryptable by the TGS key;
- the ticket is unexpired;
- the client can decrypt its session key.

### Step 3 — TGS-REQ

The client sends the opaque TGT plus a fresh authenticator encrypted with the client/TGS session key.

The TGS checks:

- TGT authentication/decryption;
- expiry;
- authenticator timestamp within skew;
- authenticator replay cache.

### Step 4 — TGS-REP and service ticket

The TGS creates a new client/service session key and a service ticket encrypted with the file server's long-term key.

The client receives:

- the opaque service ticket;
- the client/service session key protected with the client/TGS session key.

### Step 5 — AP-REQ to the service

The client presents the service ticket and a fresh authenticator encrypted with the client/service session key. The file service decrypts the ticket with its own key and validates the authenticator and replay state.

### Step 6 — AP-REP and mutual authentication

The service returns the client's authenticator timestamp + 1, encrypted with the client/service session key. Only the genuine service could produce that response, so the client also authenticates the server.

### Step 7 — Replay defence

The lab re-presents the exact same authenticator. The replay cache recognises it and rejects the request, demonstrating why timestamps and nonces matter.

---

## 4. Cryptographic implementation

| Property | Simulation |
|---|---|
| Ticket encryption | AES-256-GCM |
| Key derivation | HMAC-SHA256 with purpose separation |
| Client/TGS/service session keys | 32 random bytes, Base64URL |
| Clock skew | 300 seconds |
| Ticket lifetime | 300 seconds |
| Replay cache | In-memory set in the API process |
| Key display | 16-hex-character fingerprint only |
| Transport | None; all messages are in-process objects |

The code uses authenticated encryption, so tampered ciphertext is rejected before JSON parsing.

---

## 5. What the UI shows

The Kerberos page presents:

- a prominent simulation disclaimer;
- a flow diagram (client → AS → TGS → file service);
- a seven-step transcript with from/to principals, validation results, ticket previews and key fingerprints;
- six checks: pre-authentication, TGT issued, service ticket issued, authenticator freshness, mutual authentication, replay rejected;
- a limitations list;
- a simulation-vs-real-Kerberos comparison table.

The endpoint is administrator-only (`kerberos:demo`) and each run creates a `KERBEROS_SIMULATION_RUN` audit event.

---

## 6. Simulation versus real Kerberos

| Property | SSIMS simulation | Real Kerberos v5 |
|---|---|---|
| KDC | None | Required AS + TGS |
| Wire protocol | None | AS-REQ/AS-REP, TGS-REQ/TGS-REP, AP-REQ/AP-REP |
| Transport | In-process | UDP/TCP, often port 88 |
| Client authentication | Derived demo key | Long-term key derived from password/keytab |
| Service integration | Modelled service principal | Keytab/SPNEGO/GSSAPI integration |
| Time source | Local clock | Synchronized NTP required |
| Replay cache | Process memory | KDC/service implementation-specific |
| Ticket format | JSON inside AES-GCM | ASN.1 DER Kerberos tickets |
| Directory integration | None | Active Directory/FreeIPA/MIT KDC |
| Production use | No | Yes |

---

## 7. If this were implemented for real

A production deployment would:

1. Deploy a KDC or integrate with Active Directory.
2. Create service principals and export keytabs with restricted filesystem permissions.
3. Configure DNS SRV records, realm discovery and NTP.
4. Use GSSAPI/SPNEGO at the application server or a brokered OIDC/SAML gateway.
5. Protect the KDC with network segmentation, host hardening and monitoring.
6. Use TLS for browser-to-gateway traffic; Kerberos itself does not encrypt application payloads.
7. Establish key rotation, ticket lifetime and delegation policies.
8. Test clock skew, replay, ticket expiry and service principal mismatch scenarios.

The current module is deliberately isolated so that no evaluator mistakes it for an actual Kerberos deployment.

---

## 8. Verification

Unit test:

```ts
const result = runKerberosSimulation();
expect(result.result).toBe('passed');
expect(result.checks.mutualAuthentication).toBe(true);
expect(result.checks.replayRejected).toBe(true);
expect(result.steps).toHaveLength(7);
```

Live API test:

```bash
POST /api/kerberos/simulate
```

Result in the verified environment:

- 7 steps;
- pre-authentication, TGT, service ticket, freshness, mutual authentication and replay rejection all true;
- admin-only access;
- audit event recorded.

The UI suite confirms the disclaimer and page render.

---

## 9. Limitations

- Not interoperable with any Kerberos implementation.
- No real principal credentials or keytabs.
- No network transport or ASN.1 encoding.
- In-memory replay cache is per-process and resets on restart.
- Ticket lifetime and clock skew are demonstration values.
- It does not provide actual single sign-on to other services.
- It is an educational protocol model, not a security boundary for SSIMS authentication.
