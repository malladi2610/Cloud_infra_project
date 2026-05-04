# Build a shared naming prefix used by all resource names.
locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# Create the deployment resource group that scopes all Azure resources.
resource "azurerm_resource_group" "core" {
  name     = "${local.name_prefix}-rg"
  location = var.location
  tags     = var.tags
}
