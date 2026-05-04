# Read tenant and client metadata from the active Azure identity context.
data "azurerm_client_config" "current" {}

# Derive a compliant Key Vault name when an explicit name is not provided.
locals {
  generated_key_vault_name = substr(
    join("", regexall("[0-9a-z]", lower("${var.project_name}${var.environment}kv"))),
    0,
    24
  )

  effective_key_vault_name = var.key_vault_name != "" ? var.key_vault_name : local.generated_key_vault_name
}

# Provision Key Vault for centralized secret management and RBAC-based access.
resource "azurerm_key_vault" "core" {
  name                       = local.effective_key_vault_name
  location                   = azurerm_resource_group.core.location
  resource_group_name        = azurerm_resource_group.core.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = var.key_vault_soft_delete_retention_days
  tags                       = var.tags
}
