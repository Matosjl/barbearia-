#!/bin/sh
# ============================================================================
#  Backup do PostgreSQL — dump comprimido + retenção + (opcional) object storage
#  Executado por cron no container "backup" (ver docker-compose.yml).
#  Conecta por NOME DE CONTAINER (PGHOST=postgres).
# ============================================================================
set -eu

TS=$(date +%Y%m%d_%H%M%S)
OUT="/backups/barber_${TS}.dump"

echo "[backup] iniciando dump de ${PGDATABASE} em ${PGHOST}..."
# formato custom (-Fc): permite restauração seletiva e paralela com pg_restore
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$OUT"
echo "[backup] gerado: ${OUT} ($(du -h "$OUT" | cut -f1))"

# Retenção: remove dumps mais antigos que BACKUP_RETENTION_DAYS
find /backups -name 'barber_*.dump' -type f -mtime +"${BACKUP_RETENTION_DAYS}" -delete
echo "[backup] retenção aplicada (> ${BACKUP_RETENTION_DAYS} dias removidos)"

# (Opcional) enviar para object storage — descomente e configure no .env
# if [ -n "${S3_BUCKET:-}" ]; then
#   aws --endpoint-url "$S3_ENDPOINT" s3 cp "$OUT" "s3://$S3_BUCKET/postgres/"
#   echo "[backup] enviado para s3://$S3_BUCKET/postgres/"
# fi

echo "[backup] concluído."
# Restaurar:  pg_restore -h postgres -U postgres -d barber --clean --if-exists /backups/barber_XXXX.dump
