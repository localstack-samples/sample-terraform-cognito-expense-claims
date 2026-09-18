# ---------------------------------------------------------------------------
# HTTP API with a JWT authorizer. API Gateway downloads the pool's JWKS from
# the issuer, verifies signature, expiry and audience, and passes the claims
# to the Lambda. Routes that carry authorization_scopes additionally require
# the access token to hold one of those scopes.
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "api" {
  name          = "${var.app_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.spa_origin]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer = local.issuer
    # Access tokens carry client_id rather than aud; API Gateway accepts either.
    audience = [
      aws_cognito_user_pool_client.spa.id,
      aws_cognito_user_pool_client.payroll_export.id,
    ]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

locals {
  # route key => scopes the access token must carry (empty = any valid token)
  routes = {
    "POST /claims"              = []
    "GET /claims"               = []
    "POST /claims/{id}/approve" = []
    "GET /claims/approved"      = ["expenses/read"]
  }
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = local.routes

  api_id               = aws_apigatewayv2_api.api.id
  route_key            = each.key
  target               = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.cognito.id
  authorization_scopes = each.value
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}
