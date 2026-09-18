// Machine-to-machine caller: gets an access token with the client_credentials
// grant and lists approved claims. No user is involved.
//   npm run payroll-export
process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const { COGNITO_ISSUER, PAYROLL_EXPORT_CLIENT_ID, PAYROLL_EXPORT_CLIENT_SECRET, API_URL } = process.env as Record<string, string>;

// 1. Discover the token endpoint from the pool's OpenID configuration.
const discovery = await fetch(`${COGNITO_ISSUER}/.well-known/openid-configuration`).then((r) => r.json());

// 2. Exchange client id + secret for an access token limited to expenses/read.
const basic = Buffer.from(`${PAYROLL_EXPORT_CLIENT_ID}:${PAYROLL_EXPORT_CLIENT_SECRET}`).toString("base64");
const tokenResponse = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", scope: "expenses/read" }),
});
if (!tokenResponse.ok) throw new Error(`token endpoint returned ${tokenResponse.status}: ${await tokenResponse.text()}`);
const { access_token, expires_in } = await tokenResponse.json();

const payload = JSON.parse(Buffer.from(access_token.split(".")[1], "base64url").toString());
console.log(`Token for client_id=${payload.client_id} scope="${payload.scope}" expires in ${expires_in}s\n`);

// 3. Call the scope-protected route. User tokens are rejected here with 403.
const response = await fetch(`${API_URL}/claims/approved`, { headers: { authorization: `Bearer ${access_token}` } });
if (!response.ok) throw new Error(`API returned ${response.status}: ${await response.text()}`);
const { claims, total } = await response.json();

if (claims.length === 0) {
  console.log("No approved claims yet.");
} else {
  console.table(claims.map((c: Record<string, string | number>) => ({ id: String(c.id).slice(0, 8), description: c.description, amount: c.amount, approvedAt: c.approvedAt })));
  console.log(`\n${claims.length} approved claim(s), total ${total.toFixed(2)}`);
}
