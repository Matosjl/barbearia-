# Introspecção do grafo relacional: aplica o schema e analisa FKs / órfãs.
$ErrorActionPreference = "Continue"
$DBDIR  = "C:\BarberProject\database"
$RESULT = Join-Path $DBDIR "introspect_result.txt"
"" | Set-Content $RESULT
function Log($m){ $m | Tee-Object -FilePath $RESULT -Append }
$PG = "C:\Program Files\PostgreSQL\17\bin"
$env:PGOPTIONS = "-c client_min_messages=warning"
$DATA = Join-Path $env:TEMP "barber_pg_introspect"; $PORT=55433
$psql = @("-h","127.0.0.1","-p","$PORT","-U","postgres","-v","ON_ERROR_STOP=1")
if (Test-Path (Join-Path $DATA "postmaster.pid")) {
  $op=(Get-Content (Join-Path $DATA "postmaster.pid")|Select-Object -First 1); if($op){Stop-Process -Id ([int]$op) -Force -EA SilentlyContinue}
}
Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -EA SilentlyContinue | ? {$_.CommandLine -like "*barber_pg_introspect*"} | % {Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}
Start-Sleep 2; if(Test-Path $DATA){Remove-Item -Recurse -Force $DATA -EA SilentlyContinue}
& "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
$srv = Start-Process -FilePath "$PG\postgres.exe" -ArgumentList @("-D",$DATA,"-p","$PORT") -WindowStyle Hidden -PassThru -RedirectStandardError "$DATA\e.log" -RedirectStandardOutput "$DATA\o.log"
for($i=0;$i -lt 30;$i++){Start-Sleep 1; & "$PG\psql.exe" @psql -d postgres -c "SELECT 1;" *>$null; if($LASTEXITCODE -eq 0){break}}
& "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null
foreach($f in @("01_schema.sql","02_triggers.sql","05_improvements.sql","06_extensions.sql","07_whatsapp_crm.sql","08_relational_hardening.sql","03_views.sql")){
  & "$PG\psql.exe" @psql -d barber -f (Join-Path $DBDIR $f) *>$null
}
try {
  Log "### TOTAL DE FOREIGN KEYS"
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c "SELECT count(*) FROM pg_constraint WHERE contype='f';") -join "")

  Log "`n### TABELAS COM barbershop_id (multi-tenant)"
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='barbershop_id';") -join "")
  Log "### TABELAS-BASE TOTAIS"
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';") -join "")

  Log "`n### TABELAS SEM barbershop_id (justificar):"
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c "SELECT t.table_name FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_type='BASE TABLE' AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='barbershop_id') ORDER BY 1;") -join "`n")

  Log "`n### TABELAS ORFAS (sem FK de entrada NEM de saida):"
  $orphan = @"
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype='f' AND (k.conrelid=c.oid OR k.confrelid=c.oid))
ORDER BY 1;
"@
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c $orphan) -join "`n")

  Log "`n### GRAU RELACIONAL POR TABELA (out=FK que ela tem, in=FK que apontam pra ela):"
  $deg = @"
SELECT rpad(c.relname,28)
       || ' out=' || (SELECT count(*) FROM pg_constraint k WHERE k.contype='f' AND k.conrelid=c.oid)
       || ' in='  || (SELECT count(*) FROM pg_constraint k WHERE k.contype='f' AND k.confrelid=c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY (SELECT count(*) FROM pg_constraint k WHERE k.contype='f' AND k.confrelid=c.oid) DESC,
         (SELECT count(*) FROM pg_constraint k WHERE k.contype='f' AND k.conrelid=c.oid) DESC;
"@
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c $deg) -join "`n")

  Log "`n### FKs que referenciam customers (reaproveitamento do cliente):"
  $custfk = @"
SELECT conrelid::regclass::text FROM pg_constraint
WHERE contype='f' AND confrelid='customers'::regclass ORDER BY 1;
"@
  Log ((& "$PG\psql.exe" @psql -d barber -t -A -c $custfk) -join "`n")
}
finally {
  if($srv){Stop-Process -Id $srv.Id -Force -EA SilentlyContinue}
  & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null
  Start-Sleep 2; Remove-Item -Recurse -Force $DATA -EA SilentlyContinue
  Log "`n[done]"
}
