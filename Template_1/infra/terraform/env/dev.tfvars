project_name = "template1classifier"
environment  = "dev"
location     = "swedencentral"

// Old image with the static website not hosted
# app_image = "template1classifierdevacr.azurecr.io/template1-app:dev"
app_image = "template1classifierdevacr.azurecr.io/template1-app:dev-ref-fix-2"

n8n_image = "template1classifierdevacr.azurecr.io/template1-n8n:dev"

postgres_sku        = "B_Standard_B1ms"
postgres_storage_mb = 32768

key_vault_name = "t1classdevkv01"


tags = {
  project     = "template1classifier"
  environment = "dev"
  owner       = "subhash"
  managed_by  = "terraform"
  workload    = "classification-platform"
}

postgres_server_name                   = "t1classdevpg01"
postgres_admin_username                = "pgadmincp9"
postgres_version                       = "16"
postgres_backup_retention_days         = 7
postgres_public_network_access_enabled = true
postgres_zone                          = "2"

# optional
# developer_ip = "X.X.X.X"
