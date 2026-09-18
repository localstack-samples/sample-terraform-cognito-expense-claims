import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";

const TABLE_NAME = process.env.TABLE_NAME!;
const ADMIN_GROUP = process.env.ADMIN_GROUP ?? "finance-admins";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type Claim = {
  id: string;
  owner: string; // `sub` of the employee
  description: string;
  amount: number;
  status: "submitted" | "approved";
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

// Claims arrive already verified by the API Gateway JWT authorizer. The
// function never sees a token it has to validate itself.
type Caller = {
  sub: string;
  clientId: string;
  scopes: string[];
  groups: string[];
  isAdmin: boolean;
};

function caller(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer.jwt.claims as Record<string, unknown>;
  const scopes = String(claims.scope ?? "").split(" ").filter(Boolean);
  const groups = parseGroups(claims["cognito:groups"]);
  return {
    sub: String(claims.sub),
    clientId: String(claims.client_id ?? claims.aud ?? ""),
    scopes,
    groups,
    isAdmin: groups.includes(ADMIN_GROUP),
  };
}

// API Gateway flattens array claims into a string like "[finance-admins]".
function parseGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  return value.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const who = caller(event);

  switch (event.routeKey) {
    case "POST /claims":
      return submitClaim(event, who);
    case "GET /claims":
      return listClaims(who);
    case "POST /claims/{id}/approve":
      return approveClaim(event, who);
    case "GET /claims/approved":
      // API Gateway already required the expenses/read scope for this route.
      return listApproved(who);
    default:
      return json(404, { message: `No handler for ${event.routeKey}` });
  }
}

async function submitClaim(event: APIGatewayProxyEventV2WithJWTAuthorizer, who: Caller) {
  const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body) : {};
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim();
  if (!description || !Number.isFinite(amount) || amount <= 0) {
    return json(400, { message: "description and a positive amount are required" });
  }
  const claim: Claim = {
    id: randomUUID(),
    owner: who.sub,
    description,
    amount,
    status: "submitted",
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: claim }));
  return json(201, claim);
}

async function listClaims(who: Caller) {
  const all = await scanAll();
  // Finance admins see every claim; everyone else only their own.
  const visible = who.isAdmin ? all : all.filter((c) => c.owner === who.sub);
  return json(200, { claims: sortNewestFirst(visible), viewer: { sub: who.sub, groups: who.groups } });
}

async function approveClaim(event: APIGatewayProxyEventV2WithJWTAuthorizer, who: Caller) {
  if (!who.isAdmin) {
    return json(403, { message: `Only members of ${ADMIN_GROUP} may approve claims`, groups: who.groups });
  }
  const id = event.pathParameters?.id;
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
  if (!existing.Item) return json(404, { message: "Claim not found" });
  if (existing.Item.status === "approved") return json(409, { message: "Claim is already approved" });

  const now = new Date().toISOString();
  const updated = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET #s = :approved, approvedBy = :by, approvedAt = :at",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":approved": "approved", ":by": who.sub, ":at": now },
      ReturnValues: "ALL_NEW",
    }),
  );
  return json(200, updated.Attributes);
}

async function listApproved(who: Caller) {
  const all = await scanAll();
  const approved = sortNewestFirst(all.filter((c) => c.status === "approved"));
  return json(200, {
    claims: approved,
    total: approved.reduce((sum, c) => sum + c.amount, 0),
    caller: { clientId: who.clientId, scopes: who.scopes },
  });
}

async function scanAll(): Promise<Claim[]> {
  const items: Claim[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey }));
    items.push(...((page.Items ?? []) as Claim[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const sortNewestFirst = (claims: Claim[]) => [...claims].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
