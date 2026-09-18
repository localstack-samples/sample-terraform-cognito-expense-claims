// Integration test against the deployed stack (LocalStack by default).
// It creates its own users, so the manual walkthrough and this test never clash.
//   npm test
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const env = process.env as Record<string, string>;
const { COGNITO_ISSUER, COGNITO_ENDPOINT, COGNITO_USER_POOL_ID, COGNITO_SPA_CLIENT_ID, API_URL, PAYROLL_EXPORT_CLIENT_ID, PAYROLL_EXPORT_CLIENT_SECRET, CLAIMS_TABLE } = env;

// Against LocalStack any credentials work; against AWS the default chain is used.
const isLocalStack = COGNITO_ENDPOINT.includes("localhost");
const awsConfig = {
  region: "us-east-1",
  endpoint: COGNITO_ENDPOINT,
  ...(isLocalStack ? { credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}),
};
const cognito = new CognitoIdentityProviderClient(awsConfig);
const dynamodb = new DynamoDBClient(awsConfig);

const run = Math.random().toString(36).slice(2, 8);
const employee = { email: `employee-${run}@example.com`, password: "Passw0rd1" };
const admin = { email: `admin-${run}@example.com`, password: "Passw0rd1" };

async function createUser(email: string, password: string) {
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
    }),
  );
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: COGNITO_USER_POOL_ID, Username: email, Password: password, Permanent: true }));
}

async function passwordAuth(email: string, password: string) {
  return cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_SPA_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
}

function totpCode(secret: string) {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

/** Wait for the next 30-second window so a code is never reused. */
async function freshTotpCode(secret: string, previous: string) {
  let code = totpCode(secret);
  while (code === previous) {
    await new Promise((r) => setTimeout(r, 1000));
    code = totpCode(secret);
  }
  return code;
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("expense claims with Cognito", () => {
  let employeeToken: string;
  let adminToken: string;
  let claimId: string;

  beforeAll(async () => {
    await createUser(employee.email, employee.password);
    await createUser(admin.email, admin.password);
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: COGNITO_USER_POOL_ID, Username: admin.email, GroupName: "finance-admins" }));
  });

  afterAll(async () => {
    for (const { email } of [employee, admin]) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: COGNITO_USER_POOL_ID, Username: email })).catch(() => undefined);
    }
    if (claimId) {
      await dynamodb.send(new DeleteItemCommand({ TableName: CLAIMS_TABLE, Key: { id: { S: claimId } } })).catch(() => undefined);
    }
  });

  it("issues tokens whose issuer matches the pool's OpenID configuration", async () => {
    const auth = await passwordAuth(employee.email, employee.password);
    employeeToken = auth.AuthenticationResult!.AccessToken!;
    const payload = JSON.parse(Buffer.from(employeeToken.split(".")[1], "base64url").toString());
    const discovery = await fetch(`${COGNITO_ISSUER}/.well-known/openid-configuration`).then((r) => r.json());
    expect(payload.iss).toBe(discovery.issuer);
    expect(payload.token_use).toBe("access");
  });

  it("rejects requests without a valid token at the gateway", async () => {
    const response = await fetch(`${API_URL}/claims`);
    expect(response.status).toBe(401);
    const forged = await api("/claims", employeeToken.slice(0, -4) + "AAAA");
    expect(forged.status).toBe(401);
  });

  it("lets an employee submit and list their own claims", async () => {
    const created = await api("/claims", employeeToken, { method: "POST", body: JSON.stringify({ description: "Taxi to airport", amount: 42.5 }) });
    expect(created.status).toBe(201);
    claimId = created.body.id;
    expect(created.body.status).toBe("submitted");

    const list = await api("/claims", employeeToken);
    expect(list.status).toBe(200);
    expect(list.body.claims.map((c: { id: string }) => c.id)).toContain(claimId);
    expect(list.body.viewer.groups).toEqual([]);
  });

  it("refuses approval from someone outside finance-admins", async () => {
    const result = await api(`/claims/${claimId}/approve`, employeeToken, { method: "POST" });
    expect(result.status).toBe(403);
  });

  it("makes the admin enrol TOTP and answer the challenge on the next sign-in", async () => {
    // First sign-in: no factor yet, tokens come back directly.
    const first = await passwordAuth(admin.email, admin.password);
    const setupToken = first.AuthenticationResult!.AccessToken!;

    const { SecretCode } = await cognito.send(new AssociateSoftwareTokenCommand({ AccessToken: setupToken }));
    const enrolCode = totpCode(SecretCode!);
    const verified = await cognito.send(new VerifySoftwareTokenCommand({ AccessToken: setupToken, UserCode: enrolCode }));
    expect(verified.Status).toBe("SUCCESS");
    await cognito.send(
      new SetUserMFAPreferenceCommand({ AccessToken: setupToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } }),
    );

    // Second sign-in: Cognito now demands the code.
    const second = await passwordAuth(admin.email, admin.password);
    expect(second.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");

    const wrong = cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: COGNITO_SPA_CLIENT_ID,
        ChallengeName: "SOFTWARE_TOKEN_MFA",
        Session: second.Session,
        ChallengeResponses: { USERNAME: admin.email, SOFTWARE_TOKEN_MFA_CODE: "000000" },
      }),
    );
    await expect(wrong).rejects.toMatchObject({ name: "CodeMismatchException" });

    const third = await passwordAuth(admin.email, admin.password);
    const answered = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: COGNITO_SPA_CLIENT_ID,
        ChallengeName: "SOFTWARE_TOKEN_MFA",
        Session: third.Session,
        ChallengeResponses: { USERNAME: admin.email, SOFTWARE_TOKEN_MFA_CODE: await freshTotpCode(SecretCode!, enrolCode) },
      }),
    );
    adminToken = answered.AuthenticationResult!.AccessToken!;
    const payload = JSON.parse(Buffer.from(adminToken.split(".")[1], "base64url").toString());
    expect(payload["cognito:groups"]).toContain("finance-admins");
  });

  it("lets the admin approve the claim", async () => {
    const result = await api(`/claims/${claimId}/approve`, adminToken, { method: "POST" });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("approved");
  });

  it("keeps user tokens away from the scope-protected export route", async () => {
    const result = await api("/claims/approved", adminToken);
    expect(result.status).toBe(403);
  });

  it("lets the payroll export read approved claims with a client_credentials token", async () => {
    const discovery = await fetch(`${COGNITO_ISSUER}/.well-known/openid-configuration`).then((r) => r.json());
    const basic = Buffer.from(`${PAYROLL_EXPORT_CLIENT_ID}:${PAYROLL_EXPORT_CLIENT_SECRET}`).toString("base64");
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "expenses/read" }),
    });
    expect(tokenResponse.status).toBe(200);
    const { access_token } = await tokenResponse.json();

    const result = await api("/claims/approved", access_token);
    expect(result.status).toBe(200);
    expect(result.body.caller.scopes).toContain("expenses/read");
    expect(result.body.claims.map((c: { id: string }) => c.id)).toContain(claimId);
  });
});
