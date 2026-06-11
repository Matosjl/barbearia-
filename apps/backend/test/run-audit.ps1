# ============================================================================
#  Auditoria HTTP: sobe Postgres temp + backend real e roda
#  load-test -> smoke -> audit-permissions (nesta ordem por causa do rate limit).
# ============================================================================
$ErrorActionPreference = "Continue"
$ROOT = "C:\BarberProject"; $BE = "$ROOT\apps\backend"
$RESULT = "$BE\test\audit_http_result.txt"; "" | Set-Content $RESULT
function Log($m){ $m | Tee-Object -FilePath $RESULT -Append }
$PG = "C:\Program Files\PostgreSQL\17\bin"; $env:PGOPTIONS = "-c client_min_messages=warning"
$DATA = Join-Path $env:TEMP "barber_pg_audit_http"; $PORT = 55443
$srv = $null; $node = $null
function Cleanup {
  if ($node) { Stop-Process -Id $node.Id -Force -EA SilentlyContinue }
  if ($srv)  { Stop-Process -Id $srv.Id  -Force -EA SilentlyContinue }
  & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null
  Start-Sleep 2; Remove-Item -Recurse -Force $DATA -EA SilentlyContinue
}
try {
  if (Test-Path (Join-Path $DATA "postmaster.pid")) { $op=(Get-Content (Join-Path $DATA "postmaster.pid")|Select-Object -First 1); if($op){Stop-Process -Id ([int]$op) -Force -EA SilentlyContinue} }
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -EA SilentlyContinue | ? {$_.CommandLine -like "*barber_pg_audit_http*"} | % {Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}
  Start-Sleep 2; if(Test-Path $DATA){Remove-Item -Recurse -Force $DATA -EA SilentlyContinue}
  & "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
  $srv = Start-Process -FilePath "$PG\postgres.exe" -ArgumentList @("-D",$DATA,"-p","$PORT") -WindowStyle Hidden -PassThru -RedirectStandardError "$DATA\e.log" -RedirectStandardOutput "$DATA\o.log"
  for($i=0;$i -lt 30;$i++){Start-Sleep 1; & "$PG\psql.exe" -h 127.0.0.1 -p $PORT -U postgres -d postgres -c "SELECT 1;" *>$null; if($LASTEXITCODE -eq 0){break}}
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null

  $env:NODE_ENV="production"; $env:PORT="3000"
  $env:ADMIN_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/barber"
  $env:APP_DATABASE_URL="postgres://barber_app@127.0.0.1:$PORT/barber"
  $env:POSTGRES_USER="barber_app"; $env:POSTGRES_PASSWORD="barber_app_pass"
  $env:MIGRATIONS_DIR="$ROOT\database"
  $env:JWT_ACCESS_SECRET="test-access"; $env:JWT_REFRESH_SECRET="test-refresh"
  $env:RATE_LIMIT_AUTH="25"
  Remove-Item Env:REDIS_URL -EA SilentlyContinue

  $mig = & node "$BE\db\migrate.js" 2>&1; $mig | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { throw "migração falhou" }

  $node = Start-Process -FilePath "node" -ArgumentList @("$BE\src\index.js") -WorkingDirectory $BE -WindowStyle Hidden -PassThru -RedirectStandardOutput "$BE\test\server2.log" -RedirectStandardError "$BE\test\server2.err.log"
  $ready=$false
  for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try { $r=Invoke-WebRequest "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){$ready=$true;break} } catch {} }
  if (-not $ready) { Get-Content "$BE\test\server2.err.log" -EA SilentlyContinue | % { Log $_ }; throw "backend nao subiu" }
  $env:BASE_URL="http://localhost:3000"

  $fail = 0
  Log "`n--- LOAD TEST ---"
  $o = & node "$BE\test\load-test.mjs" 2>&1; $o | ForEach-Object { Log $_ }; if ($LASTEXITCODE -ne 0) { $fail++ }
  Log "`n--- SMOKE ---"
  $o = & node "$BE\test\smoke.mjs" 2>&1; $o | ForEach-Object { Log $_ }; if ($LASTEXITCODE -ne 0) { $fail++ }
  Log "`n--- PERMISSÕES / MULTI-TENANT ---"
  $o = & node "$BE\test\audit-permissions.mjs" 2>&1; $o | ForEach-Object { Log $_ }; if ($LASTEXITCODE -ne 0) { $fail++ }

  if ($fail -eq 0) { Log "`n==================== AUDITORIA HTTP: TUDO PASSOU ====================" }
  else { Log "`n==================== AUDITORIA HTTP: $fail SUITE(S) FALHARAM ====================" }
}
catch { Log "ERRO: $_" }
finally { Cleanup }
