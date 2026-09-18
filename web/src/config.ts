// Values come from web/.env.local, written by `npm run configure` from the
// Terraform outputs. Nothing here is LocalStack-specific: point the issuer
// and endpoint at a real user pool and the app works unchanged.
function required(name: string): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`${name} is not set. Run "npm run configure" after "terraform apply".`);
  return value;
}

export const config = {
  issuer: required("VITE_COGNITO_ISSUER"), // e.g. http://localhost.localstack.cloud:4566/us-east-1_abc123
  cognitoEndpoint: required("VITE_COGNITO_ENDPOINT"), // e.g. http://localhost.localstack.cloud:4566
  clientId: required("VITE_COGNITO_SPA_CLIENT_ID"),
  apiUrl: required("VITE_API_URL"),
  appName: "Expenses Portal",
};
