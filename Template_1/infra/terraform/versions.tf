# Pin Terraform CLI and provider version constraints for reproducible runs.
terraform {
  required_version = ">= 1.6.0"

  # Declare provider sources and minimum versions required by this module.
  required_providers {
    # Azure Resource Manager provider for all Azure infrastructure resources.
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.2.0"
    }
    # Utility provider used for generated/random values when needed.
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}
