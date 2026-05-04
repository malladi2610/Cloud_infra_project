# Configure how Terraform authenticates and interacts with Azure APIs.
provider "azurerm" {
  # Enable provider feature defaults required by azurerm.
  features {}
  # Use explicit subscription override when provided, otherwise use Azure CLI context.
  subscription_id = var.subscription_id != "" ? var.subscription_id : null
  # Disable auto-registration to avoid RP registration race/conflict errors.
  resource_provider_registrations = "none"
}
