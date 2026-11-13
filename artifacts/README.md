# Verification Evidence

Generated on 11 November 2026 against the local SSIMS deployment.

| File | Description |
|---|---|
| `screenshots/` | Sixteen headless Edge screenshots of the login, administrator, lecturer, student and mobile interfaces |
| `ui-verification.json` | 29/29 UI checks with browser console/API error lists and full-refresh session-restoration checks |
| `e2e-smoke-output.txt` | 41/41 API and security checks, including all eight laboratory exercises |
| `functional-e2e-output.txt` | 41/41 functional workflow checks: CRUD, RBAC, forced password change, registration, password reset, grading, policy and IP rules |

The screenshots are rendered from the actual React application using the live API. They are not design mock-ups.

Test environment:

- Node.js 24.21.0 (container target Node 22)
- PostgreSQL 18.6 (container target PostgreSQL 16)
- Microsoft Edge headless via Playwright Core
- React 18, React Router 7, Vite 6
- Zod 4, Express 4, Argon2id 0.41.1

The Docker Compose deployment is provided but could not be executed in the verification environment because no Docker daemon was available. Compose YAML, service wiring, dependency locking, database roles, TLS-only configuration and network segmentation were validated separately. This limitation is documented in the test report.
