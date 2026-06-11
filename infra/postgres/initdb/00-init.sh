#!/bin/bash
# ============================================================================
#  Init do Postgres (roda 1x no volume novo). Cria:
#   - role da aplicação (barber_app) com LOGIN + senha (a migração 05 já o
#     referencia como NOLOGIN via CREATE ROLE IF NOT EXISTS; aqui damos LOGIN).
#   - database da Evolution API (separado do banco do app, mesmo servidor).
#  As MIGRAÇÕES de schema são aplicadas pelo serviço "migrate" (não aqui).
# ============================================================================
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
      CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}';
    ELSE
      ALTER ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;
EOSQL

# database da Evolution (idempotente)
if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname='${EVOLUTION_DB}'" | grep -q 1; then
  createdb -O "$POSTGRES_USER" "${EVOLUTION_DB}"
fi

echo "[initdb] role ${APP_DB_USER} e database ${EVOLUTION_DB} prontos."
