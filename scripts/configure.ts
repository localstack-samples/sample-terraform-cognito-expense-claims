// Reads Terraform outputs and writes the env files the SPA, scripts and tests use.
//   npm run configure
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const raw = execFileSync("terraform", ["output", "-json"], { cwd: resolve(root, "terraform"), encoding: "utf8" });
const outputs = Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k, (v as { value: string }).value]));

const shared = {
  COGNITO_ISSUER: outputs.issuer,
  COGNITO_ENDPOINT: outputs.cognito_endpoint,
  COGNITO_USER_POOL_ID: outputs.user_pool_id,
  COGNITO_SPA_CLIENT_ID: outputs.spa_client_id,
  API_URL: outputs.api_url,
};

// Root .env: scripts and the integration test (includes the M2M secret).
const rootEnv = {
  ...shared,
  PAYROLL_EXPORT_CLIENT_ID: outputs.payroll_export_client_id,
  PAYROLL_EXPORT_CLIENT_SECRET: outputs.payroll_export_client_secret,
  CLAIMS_TABLE: outputs.claims_table,
};
writeFileSync(resolve(root, ".env"), toEnv(rootEnv));

// web/.env.local: only public values, prefixed so Vite exposes them.
const webEnv = Object.fromEntries(Object.entries(shared).map(([k, v]) => [`VITE_${k}`, v]));
writeFileSync(resolve(root, "web/.env.local"), toEnv(webEnv));

console.log("Wrote .env and web/.env.local");
for (const [k, v] of Object.entries(shared)) console.log(`  ${k}=${v}`);
console.log(`  PAYROLL_EXPORT_CLIENT_ID=${rootEnv.PAYROLL_EXPORT_CLIENT_ID}`);
console.log("  PAYROLL_EXPORT_CLIENT_SECRET=<hidden>");

function toEnv(values: Record<string, string>) {
  return Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}
