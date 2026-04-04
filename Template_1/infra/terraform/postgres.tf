# Build a PostgreSQL server name fallback that satisfies Azure naming rules.
locals {
  generated_postgres_name = trimsuffix(
    substr(join("", regexall("[0-9a-z-]", lower("${var.project_name}-${var.environment}-pg"))), 0, 63),
    "-"
  )

  effective_postgres_name = var.postgres_server_name != "" ? var.postgres_server_name : local.generated_postgres_name
}

# Create the managed PostgreSQL Flexible Server used by app and n8n databases.
resource "azurerm_postgresql_flexible_server" "core" {
  name                          = local.effective_postgres_name
  resource_group_name           = azurerm_resource_group.core.name
  location                      = azurerm_resource_group.core.location
  version                       = var.postgres_version
  zone                          = var.postgres_zone
  administrator_login           = var.postgres_admin_username
  administrator_password        = var.postgres_admin_password
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = var.postgres_backup_retention_days
  public_network_access_enabled = var.postgres_public_network_access_enabled
  tags                          = var.tags
}

# Create the application data database used by the frontend/API service.
resource "azurerm_postgresql_flexible_server_database" "classifier" {
  name      = "classifier"
  server_id = azurerm_postgresql_flexible_server.core.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Create the dedicated n8n metadata database on the same PostgreSQL server.
resource "azurerm_postgresql_flexible_server_database" "n8ndb" {
  name      = "n8ndb"
  server_id = azurerm_postgresql_flexible_server.core.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Allow Azure-hosted services to connect to PostgreSQL during runtime.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.core.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Optionally allow a single developer public IP for direct troubleshooting access.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_developer_ip" {
  count            = var.developer_ip != "" ? 1 : 0
  name             = "allow-developer-ip"
  server_id        = azurerm_postgresql_flexible_server.core.id
  start_ip_address = var.developer_ip
  end_ip_address   = var.developer_ip
}
