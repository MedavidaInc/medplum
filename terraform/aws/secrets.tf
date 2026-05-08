# ─── DB password ──────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "medavida/staging/db-password"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

# ─── Bot secrets (populated manually after deploy) ────────────────────────────

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name                    = "medavida/stripe-secret-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret" "pharmacy_adapter_api_key" {
  name                    = "medavida/pharmacy-adapter-api-key"
  recovery_window_in_days = 0
}
