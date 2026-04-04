# Generate a lowercase alphanumeric ACR name within Azure length limits.
locals {
  acr_name = substr(
    join("", regexall("[0-9a-z]", lower("${var.project_name}${var.environment}acr"))),
    0,
    50
  )
}

# Provision Azure Container Registry to store app and n8n container images.
resource "azurerm_container_registry" "core" {
  name                = local.acr_name
  location            = azurerm_resource_group.core.location
  resource_group_name = azurerm_resource_group.core.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = var.tags
}
