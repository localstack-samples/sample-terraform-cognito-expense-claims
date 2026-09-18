// A signed-in identity, regardless of how the tokens were obtained.
export type Session = {
  accessToken: string;
  idToken?: string;
  email: string;
  sub: string;
  groups: string[];
  /** "hosted-ui" = authorization code + PKCE; "password-totp" = in-app sign-in with MFA. */
  method: "hosted-ui" | "password-totp";
};

export type JwtPayload = Record<string, unknown> & {
  sub?: string;
  email?: string;
  exp?: number;
  "cognito:groups"?: string[];
  "cognito:username"?: string;
  username?: string;
  scope?: string;
};

/** Decode a JWT payload without verifying it. Verification is the API's job. */
export function decodeJwt(token: string): JwtPayload {
  const [, payload] = token.split(".");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

export function sessionFromTokens(accessToken: string, idToken: string | undefined, method: Session["method"]): Session {
  const access = decodeJwt(accessToken);
  const id = idToken ? decodeJwt(idToken) : {};
  return {
    accessToken,
    idToken,
    email: String(id.email ?? access.username ?? "unknown"),
    sub: String(access.sub),
    groups: access["cognito:groups"] ?? id["cognito:groups"] ?? [],
    method,
  };
}
