// Direct calls to the Cognito user pool API for the parts the hosted UI does
// not cover: the password + TOTP sign-in and TOTP enrolment.
//
// Cognito speaks JSON over HTTP; unauthenticated operations only need the
// X-Amz-Target header, which is exactly what the AWS SDKs send under the hood.
import { config } from "../config";
import { sessionFromTokens, type Session } from "./session";

type CognitoError = { __type?: string; message?: string };

async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(config.cognitoEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & CognitoError;
  if (!response.ok) {
    const type = (data.__type ?? "Error").split("#").pop();
    throw new Error(`${type}: ${data.message ?? response.statusText}`);
  }
  return data;
}

type AuthResult = {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AuthenticationResult?: { AccessToken: string; IdToken: string; RefreshToken?: string };
};

export type PasswordSignInResult =
  | { kind: "signed-in"; session: Session }
  | { kind: "totp-required"; session: string; username: string }
  | { kind: "other-challenge"; challenge: string };

/** Step 1 of the in-app sign-in. Returns tokens, or a TOTP challenge to answer. */
export async function signInWithPassword(email: string, password: string): Promise<PasswordSignInResult> {
  const result = await cognito<AuthResult>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (result.AuthenticationResult) {
    const { AccessToken, IdToken } = result.AuthenticationResult;
    return { kind: "signed-in", session: sessionFromTokens(AccessToken, IdToken, "password-totp") };
  }
  if (result.ChallengeName === "SOFTWARE_TOKEN_MFA") {
    return { kind: "totp-required", session: result.Session!, username: result.ChallengeParameters?.USER_ID_FOR_SRP ?? email };
  }
  return { kind: "other-challenge", challenge: result.ChallengeName ?? "unknown" };
}

/** Step 2: answer the SOFTWARE_TOKEN_MFA challenge with a code from the authenticator app. */
export async function answerTotpChallenge(session: string, username: string, code: string): Promise<Session> {
  const result = await cognito<AuthResult>("RespondToAuthChallenge", {
    ClientId: config.clientId,
    ChallengeName: "SOFTWARE_TOKEN_MFA",
    Session: session,
    ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code },
  });
  if (!result.AuthenticationResult) throw new Error(`Unexpected challenge ${result.ChallengeName}`);
  const { AccessToken, IdToken } = result.AuthenticationResult;
  return sessionFromTokens(AccessToken, IdToken, "password-totp");
}

// --- TOTP enrolment (needs an access token with aws.cognito.signin.user.admin) ---

/** Ask Cognito for a new TOTP secret for the signed-in user. */
export async function associateSoftwareToken(accessToken: string): Promise<string> {
  const { SecretCode } = await cognito<{ SecretCode: string }>("AssociateSoftwareToken", { AccessToken: accessToken });
  return SecretCode;
}

/** Prove the authenticator was set up correctly, then make TOTP the preferred factor. */
export async function verifyAndEnableTotp(accessToken: string, code: string, deviceName = "Authenticator app") {
  const { Status } = await cognito<{ Status: string }>("VerifySoftwareToken", {
    AccessToken: accessToken,
    UserCode: code,
    FriendlyDeviceName: deviceName,
  });
  if (Status !== "SUCCESS") throw new Error(`VerifySoftwareToken returned ${Status}`);
  await cognito("SetUserMFAPreference", {
    AccessToken: accessToken,
    SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
  });
}

export type MfaStatus = { enabled: boolean; preferred?: string };

/** GetUser tells us whether TOTP is already turned on for this account. */
export async function getMfaStatus(accessToken: string): Promise<MfaStatus> {
  const user = await cognito<{ UserMFASettingList?: string[]; PreferredMfaSetting?: string }>("GetUser", { AccessToken: accessToken });
  return { enabled: (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA"), preferred: user.PreferredMfaSetting };
}

/** otpauth:// URI that authenticator apps understand (rendered as a QR code). */
export function totpUri(secret: string, email: string): string {
  const issuer = encodeURIComponent(config.appName);
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
}
