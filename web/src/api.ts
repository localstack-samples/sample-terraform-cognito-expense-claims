import { config } from "./config";

export type Claim = {
  id: string;
  owner: string;
  description: string;
  amount: number;
  status: "submitted" | "approved";
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Every call carries the access token. API Gateway verifies it against the
// pool's JWKS before the Lambda runs; a bad or missing token is a 401 here.
async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new ApiError(response.status, data.message ?? response.statusText);
  return data as T;
}

export const listClaims = (token: string) => api<{ claims: Claim[]; viewer: { sub: string; groups: string[] } }>(token, "/claims");

export const submitClaim = (token: string, description: string, amount: number) =>
  api<Claim>(token, "/claims", { method: "POST", body: JSON.stringify({ description, amount }) });

export const approveClaim = (token: string, id: string) => api<Claim>(token, `/claims/${id}/approve`, { method: "POST" });
