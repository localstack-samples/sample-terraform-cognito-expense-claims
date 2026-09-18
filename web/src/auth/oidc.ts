// Hosted UI sign-in: standard OpenID Connect authorization code flow with PKCE.
// oidc-client-ts reads /.well-known/openid-configuration from the issuer, so
// the authorize, token and logout URLs are never hard-coded here.
import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import { config } from "../config";
import { sessionFromTokens, type Session } from "./session";

export const userManager = new UserManager({
  authority: config.issuer,
  client_id: config.clientId,
  redirect_uri: `${window.location.origin}/callback`,
  response_type: "code",
  scope: "openid email profile aws.cognito.signin.user.admin",
  // Cognito's userInfo endpoint adds nothing the id token does not already have.
  loadUserInfo: false,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

/** Send the browser to the hosted UI. */
export function signInWithHostedUi() {
  return userManager.signinRedirect();
}

/** Called on /callback: exchanges ?code= for tokens (PKCE verifier included by the library). */
export async function completeHostedUiSignIn(): Promise<Session | null> {
  const user = await userManager.signinCallback();
  window.history.replaceState({}, "", "/");
  return user ? sessionFromTokens(user.access_token, user.id_token, "hosted-ui") : null;
}

/** Restore a hosted UI session from sessionStorage after a reload. */
export async function restoreHostedUiSession(): Promise<Session | null> {
  const user = await userManager.getUser();
  if (!user || user.expired) return null;
  return sessionFromTokens(user.access_token, user.id_token, "hosted-ui");
}

/**
 * Cognito's logout endpoint takes client_id and logout_uri rather than the
 * OIDC id_token_hint / post_logout_redirect_uri pair, so build the URL by hand
 * from the discovered end_session_endpoint.
 */
export async function signOutOfHostedUi() {
  const metadata = await userManager.metadataService.getMetadata();
  await userManager.removeUser();
  const logout = new URL(metadata.end_session_endpoint!);
  logout.searchParams.set("client_id", config.clientId);
  logout.searchParams.set("logout_uri", `${window.location.origin}/`);
  window.location.assign(logout.toString());
}
