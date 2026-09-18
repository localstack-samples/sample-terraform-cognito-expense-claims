# ---------------------------------------------------------------------------
# User pool: people sign in with their e-mail address. TOTP is available but
# optional, so each user decides whether to enrol (finance admins will).
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool" "pool" {
  name                     = "${var.app_name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# The hosted UI domain. LocalStack serves its login form at
# /_aws/cognito-idp/login regardless of this value; on AWS it becomes
# https://<prefix>.auth.<region>.amazoncognito.com.
resource "aws_cognito_user_pool_domain" "domain" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.pool.id
}

# Group that may approve claims. The API checks the cognito:groups claim.
resource "aws_cognito_user_group" "finance_admins" {
  name         = "finance-admins"
  user_pool_id = aws_cognito_user_pool.pool.id
  description  = "May approve expense claims (TOTP required by the app)."
}

# ---------------------------------------------------------------------------
# Resource server + custom scope for machine-to-machine access.
# The scope's full name is "<identifier>/<scope_name>" = "expenses/read".
# ---------------------------------------------------------------------------
resource "aws_cognito_resource_server" "expenses" {
  identifier   = "expenses"
  name         = "Expenses API"
  user_pool_id = aws_cognito_user_pool.pool.id

  scope {
    scope_name        = "read"
    scope_description = "Read approved claims"
  }
}

# ---------------------------------------------------------------------------
# Public client for the single-page app: authorization code + PKCE, no secret.
# aws.cognito.signin.user.admin lets the SPA call AssociateSoftwareToken and
# friends with the access token it gets back.
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.app_name}-spa"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile", "aws.cognito.signin.user.admin"]
  callback_urls                        = ["${var.spa_origin}/callback"]
  logout_urls                          = ["${var.spa_origin}/"]
  supported_identity_providers         = ["COGNITO"]

  # USER_PASSWORD_AUTH powers the in-app admin sign-in that answers the TOTP
  # challenge. REFRESH_TOKEN_AUTH keeps hosted-UI sessions alive.
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# ---------------------------------------------------------------------------
# Confidential client for the payroll export job: client_credentials only.
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "payroll_export" {
  name         = "${var.app_name}-payroll-export"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = ["${aws_cognito_resource_server.expenses.identifier}/read"]

  depends_on = [aws_cognito_resource_server.expenses]
}

locals {
  # The `iss` claim every token carries, and the URL the JWT authorizer
  # fetches /.well-known/openid-configuration and jwks.json from.
  issuer = var.localstack ? "http://${var.localstack_host}/${aws_cognito_user_pool.pool.id}" : "https://${aws_cognito_user_pool.pool.endpoint}"

  # Endpoint the SPA and scripts use for Cognito API calls (InitiateAuth, ...).
  cognito_endpoint = var.localstack ? "http://${var.localstack_host}" : "https://cognito-idp.${var.aws_region}.amazonaws.com"
}
