locals {
  generated_storage_account_name = substr(
    join("", regexall("[0-9a-z]", lower("${var.project_name}${var.environment}st"))),
    0,
    24
  )

  effective_storage_account_name = var.storage_account_name != "" ? var.storage_account_name : local.generated_storage_account_name
}

resource "azurerm_storage_account" "core" {
  name                     = local.effective_storage_account_name
  resource_group_name      = azurerm_resource_group.core.name
  location                 = azurerm_resource_group.core.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = var.tags
}

resource "azurerm_storage_container" "documents" {
  name                  = var.storage_container_name
  storage_account_id    = azurerm_storage_account.core.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "container_apps_storage_blob_contributor" {
  scope                            = azurerm_storage_account.core.id
  role_definition_name             = "Storage Blob Data Contributor"
  principal_id                     = azurerm_user_assigned_identity.container_apps.principal_id
  skip_service_principal_aad_check = true
}
