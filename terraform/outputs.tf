output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "issuer" {
  description = "Token issuer. Append /.well-known/openid-configuration for discovery."
  value       = local.issuer
}

output "cognito_endpoint" {
  description = "Endpoint for Cognito API calls from the SPA, scripts and tests."
  value       = local.cognito_endpoint
}

output "spa_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "payroll_export_client_id" {
  value = aws_cognito_user_pool_client.payroll_export.id
}

output "payroll_export_client_secret" {
  value     = aws_cognito_user_pool_client.payroll_export.client_secret
  sensitive = true
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "hosted_ui_domain" {
  value = aws_cognito_user_pool_domain.domain.domain
}

output "claims_table" {
  value = aws_dynamodb_table.claims.name
}
