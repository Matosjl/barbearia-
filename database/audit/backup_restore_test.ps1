# ============================================================================
#  TESTE DE BACKUP & RESTORE — valida a estratégia do container "backup":
#  pg_dump -Fc -> dropa o banco -> pg_restore -> confere que os dados voltaram.
# ============================================================================
$ErrorActionPreference = "Continue"
$DBDIR = "C:\BarberProject\database"
$RESULT = "$DBDIR\audit\backup_restore_result.txt"; "" | Set-Content $RESULT
function Log($m){ $m | Tee-Object -FilePath $RESULT -Append }
$PG = "C:\Program Files\PostgreSQL\17\bin"; $env:PGOPTIONS = "-c client_min_messages=warning"
$DATA = Join-Path $env:TEMP "barber_pg_backup"; $PORT = 55444
$DUMP = Join-Path $env:TEMP "barber_backup_test.dump"
$psql = @("-h","127.0.0.1","-p","$PORT","-U","postgres","-v","ON_ERROR_STOP=1")
$srv = $null
function Q($db,$sql){ (& "$PG\psql.exe" @psql -d $db -t -A -c $sql) -join "" }
try {
  if (Test-Path (Join-Path $DATA "postmaster.pid")) { $op=(Get-Content (Join-Path $DATA "postmaster.pid")|Select-Object -First 1); if($op){Stop-Process -Id ([int]$op) -Force -EA SilentlyContinue} }
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -EA SilentlyContinue | ? {$_.CommandLine -like "*barber_pg_backup*"} | % {Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}
  Start-Sleep 2; if(Test-Path $DATA){Remove-Item -Recurse -Force $DATA -EA SilentlyContinue}
  Remove-Item -Force $DUMP -EA SilentlyContinue
  & "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
  $srv = Start-Process -FilePath "$PG\postgres.exe" -ArgumentList @("-D",$DATA,"-p","$PORT") -WindowStyle Hidden -PassThru -RedirectStandardError "$DATA\e.log" -RedirectStandardOutput "$DATA\o.log"
  for($i=0;$i -lt 30;$i++){Start-Sleep 1; & "$PG\psql.exe" @psql -d postgres -c "SELECT 1;" *>$null; if($LASTEXITCODE -eq 0){break}}
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null

  Log "aplicando schema + seed..."
  foreach($f in @("01_schema.sql","02_triggers.sql","05_improvements.sql","06_extensions.sql","07_whatsapp_crm.sql","08_relational_hardening.sql","09_product_media.sql","10_indexes.sql","03_views.sql","04_seed.sql")){
    & "$PG\psql.exe" @psql -d barber -f (Join-Path $DBDIR $f) *>$null
  }
  $before = "shops=" + (Q "barber" "SELECT count(*) FROM barbershops") + " services=" + (Q "barber" "SELECT count(*) FROM services") + " barbers=" + (Q "barber" "SELECT count(*) FROM barbers") + " plans=" + (Q "barber" "SELECT count(*) FROM plans")
  Log "ANTES:  $before"

  Log "pg_dump (-Fc)..."
  & "$PG\pg_dump.exe" -h 127.0.0.1 -p $PORT -U postgres -d barber -Fc -f $DUMP
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou" }
  Log ("dump: " + ("{0:N0} KB" -f ((Get-Item $DUMP).Length/1KB)))

  Log "DROP + recreate (simula perda) ..."
  & "$PG\psql.exe" @psql -d postgres -c "DROP DATABASE barber;" | Out-Null
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null
  $empty = Q "barber" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  Log "banco recriado vazio (tabelas=$empty)"

  Log "pg_restore..."
  & "$PG\pg_restore.exe" -h 127.0.0.1 -p $PORT -U postgres -d barber $DUMP *>$null
  $after = "shops=" + (Q "barber" "SELECT count(*) FROM barbershops") + " services=" + (Q "barber" "SELECT count(*) FROM services") + " barbers=" + (Q "barber" "SELECT count(*) FROM barbers") + " plans=" + (Q "barber" "SELECT count(*) FROM plans")
  Log "DEPOIS: $after"

  if ($before -eq $after -and $before -notmatch '=0 ') { Log "PASS  backup/restore preservou os dados ($after)" }
  else { Log "FAIL  divergência: antes[$before] depois[$after]" }
}
catch { Log "ERRO: $_" }
finally {
  if($srv){Stop-Process -Id $srv.Id -Force -EA SilentlyContinue}
  & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null
  Start-Sleep 2; Remove-Item -Recurse -Force $DATA -EA SilentlyContinue; Remove-Item -Force $DUMP -EA SilentlyContinue
}
