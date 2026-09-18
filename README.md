# Expense claims with Cognito: hosted UI, PKCE, TOTP and machine-to-machine tokens on LocalStack

| Key          | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| Services     | Cognito, API Gateway (HTTP API), Lambda, DynamoDB                     |
| Integrations | Terraform, `lstk`, AWS SDK for JavaScript v3, Vite + React            |
| Categories   | Authentication; Serverless                                            |

## Introduction

A small expense-claims portal that exercises the parts of Amazon Cognito most teams actually ship, entirely against LocalStack:

- **Hosted UI with authorization code + PKCE.** Employees sign up and sign in on Cognito's login page; the single-page app never sees a password and uses the pool's OpenID Connect discovery document for every URL.
- **JWT verification with JWKS.** An HTTP API with a JWT authorizer checks signature, expiry and audience against the pool's `jwks.json` before a Lambda function runs. One route also requires a custom OAuth scope.
- **TOTP multi-factor authentication.** Finance admins enrol an authenticator app from the SPA (`AssociateSoftwareToken` → `VerifySoftwareToken` → `SetUserMFAPreference`) and afterwards answer a `SOFTWARE_TOKEN_MFA` challenge when they sign in with a password.
- **Machine-to-machine access.** A payroll export job gets a token with the `client_credentials` grant, scoped to `expenses/read`, and reads approved claims.

```
Employee ──hosted UI (code + PKCE)──▶ Cognito user pool ──JWKS──▶ HTTP API (JWT authorizer) ──▶ Lambda ──▶ DynamoDB
Finance admin ──password + TOTP (InitiateAuth / RespondToAuthChallenge)──▶ Cognito ─────────────▲
Payroll export ──client_credentials (expenses/read)──▶ Cognito token endpoint ───────────────────┘
```

Everything is created by Terraform through `lstk terraform`. The same configuration deploys to AWS with `-var localstack=false`.

## Prerequisites

- [`lstk`](https://docs.localstack.cloud/aws/developer-tools/running-localstack/lstk/) with a [LocalStack auth token](https://docs.localstack.cloud/getting-started/auth-token/) (Cognito is part of the paid tiers)
- [Docker](https://docs.docker.com/get-docker/)
- [Node.js](https://nodejs.org/) 22.12 or newer
- [Terraform](https://developer.hashicorp.com/terraform/install) 1.5 or newer
- Optional: an authenticator app on your phone. The repo ships a script that generates TOTP codes if you prefer to stay on the keyboard.

Check that everything is present:

```bash
make check
```

## Start LocalStack

The SPA runs on `http://localhost:5173` and calls Cognito's token endpoint straight from the browser. LocalStack only answers browsers whose origin is allow-listed, so pass the origin when you start it:

```bash
LOCALSTACK_EXTRA_CORS_ALLOWED_ORIGINS=http://localhost:5173 lstk start
# or: make start
```

## Install and deploy

```bash
make install     # npm install
make deploy      # bundles the Lambda, lstk terraform init + apply, writes .env and web/.env.local
```

`make deploy` ends with the values every other step needs:

```
COGNITO_ISSUER=http://localhost.localstack.cloud:4566/us-east-1_...
COGNITO_ENDPOINT=http://localhost.localstack.cloud:4566
COGNITO_USER_POOL_ID=us-east-1_...
COGNITO_SPA_CLIENT_ID=...
API_URL=http://....execute-api.localhost.localstack.cloud:4566
PAYROLL_EXPORT_CLIENT_ID=...
```

Have a look at what the pool publishes:

```bash
curl -s "$(grep COGNITO_ISSUER .env | cut -d= -f2)/.well-known/openid-configuration" | jq
```

## Run the app

```bash
make dev
```

Open <http://localhost:5173>.

### 1. Employee: sign up and submit a claim

1. Click **Sign in with hosted UI**. You land on LocalStack's Cognito login page. If it offers "Sign in as existing user", choose **Sign in as different user?**.
2. Click **Sign up**, enter an e-mail address and a password (8+ characters with upper case, lower case and a digit), then **Sign Up**.
3. The account is `UNCONFIRMED` until the verification code is entered. LocalStack does not send e-mail unless SMTP is configured; the code is in the logs:

   ```bash
   lstk logs -v | grep "Confirmation code"
   lstk aws cognito-idp confirm-sign-up \
     --client-id "$(grep COGNITO_SPA_CLIENT_ID .env | cut -d= -f2)" \
     --username sam@example.com --confirmation-code 123456
   ```

4. Back on the login page, click **Sign In**. Cognito redirects to `/callback?code=…`, the SPA exchanges the code (with the PKCE verifier) for tokens and shows the claims page.
5. Submit a claim.

### 2. Finance admin: enrol TOTP

1. Sign out, sign up a second user the same way and confirm it.
2. Put the user in the `finance-admins` group:

   ```bash
   lstk aws cognito-idp admin-add-user-to-group \
     --user-pool-id "$(grep COGNITO_USER_POOL_ID .env | cut -d= -f2)" \
     --username fin@example.com --group-name finance-admins
   ```

3. Sign in through the hosted UI. The header shows the group and the claims table lists every claim with an **Approve** button.
4. Open **Security** → **Set up an authenticator app**. Scan the QR code, or run the printed command:

   ```bash
   npm run totp -- <secret shown on the page>
   ```

   Enter the six-digit code. Cognito now lists `SOFTWARE_TOKEN_MFA` as the user's preferred factor.

### 3. Finance admin: sign in with password + TOTP and approve

1. Sign out and click **Finance admin sign-in**.
2. Enter e-mail and password. `InitiateAuth` (`USER_PASSWORD_AUTH`) returns a `SOFTWARE_TOKEN_MFA` challenge instead of tokens.
3. Enter a fresh code from the authenticator (or `npm run totp -- <secret>`). `RespondToAuthChallenge` returns the tokens.
4. Approve the employee's claim. The Lambda checks the `cognito:groups` claim before updating DynamoDB.

### 4. Payroll export: client credentials

```bash
make export
# or: npm run payroll-export
```

The script discovers the token endpoint, sends client id and secret with the `client_credentials` grant and `scope=expenses/read`, and calls `GET /claims/approved`. The route carries `authorization_scopes = ["expenses/read"]`, so user tokens from the SPA get a 403 at the gateway while the export token gets the list.

## Run the integration test

```bash
make test
```

The Vitest suite creates its own employee and admin (`AdminCreateUser`), enrols TOTP with `otpauth`, exercises submit → approve → export including the negative cases (401 for forged tokens, 403 for the wrong group and the wrong scope), then deletes what it created. It runs in about 15 seconds.

## What is where

| Path | Purpose |
| --- | --- |
| `terraform/cognito.tf` | User pool, hosted UI domain, `finance-admins` group, resource server with the `expenses/read` scope, public SPA client, confidential payroll client |
| `terraform/api.tf` | HTTP API, JWT authorizer pointed at the pool's issuer, routes (one with `authorization_scopes`) |
| `terraform/lambda.tf`, `api/src/index.ts` | Lambda that reads the verified claims from `requestContext.authorizer.jwt.claims` |
| `web/src/auth/oidc.ts` | `oidc-client-ts` configuration: authority = issuer, code + PKCE, logout URL from discovery |
| `web/src/auth/cognito.ts` | Direct Cognito API calls for password + TOTP sign-in and TOTP enrolment |
| `scripts/payroll-export.ts` | The machine-to-machine client |
| `scripts/totp.ts` | Authenticator replacement for tests and terminals |
| `test/expenses.test.ts` | Integration test |

## Notes on LocalStack

- The hosted UI lives at `http://localhost.localstack.cloud:4566/_aws/cognito-idp/login`; the `/oauth2/authorize` endpoint redirects there. The `<domain>.auth.<region>.amazoncognito.com` hostname does not exist locally. Because the SPA reads `authorization_endpoint` from discovery, nothing in the app depends on either.
- The login page remembers the last visit in a cookie and first shows "Sign in as existing user". Pick **Sign in as different user?** to reach the form.
- The login page handles password and `NEW_PASSWORD_REQUIRED` only. A user with TOTP enabled cannot finish signing in there, which is why the SPA has its own password + TOTP form. On AWS the hosted UI would present the challenge itself.
- LocalStack issues tokens from the authorization code grant without verifying the PKCE `code_verifier`. The SPA still sends it, and AWS enforces it.
- Confirmation, forgot-password and e-mail OTP codes are printed at `INFO` level. `lstk logs` hides them by default; use `lstk logs -v`.
- Browser calls to LocalStack need the origin in `EXTRA_CORS_ALLOWED_ORIGINS`; otherwise the response is `403` before Cognito sees the request.

## Deploying to AWS

```bash
cd terraform
terraform init
terraform apply -var localstack=false -var cognito_domain_prefix=<something-globally-unique>
cd .. && npm run configure
```

The issuer becomes `https://cognito-idp.<region>.amazonaws.com/<pool id>` and the SPA picks up the real hosted UI through the same discovery document. Remove the `ALLOW_USER_PASSWORD_AUTH` flow from the SPA client if you prefer SRP in production.

## Cleanup

```bash
make destroy
make stop
```

## License

This code is available under the Apache 2.0 license.
