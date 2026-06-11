# Sobe Postgres temp + backend real e roda o smoke de financeiro/dashboard.
$ErrorActionPreference = "Continue"
$ROOT = "C:\BarberProject"; $BE = "$ROOT\apps\backend"
$RESULT = "$BE\test\financial_result.txt"; "" | Set-Content $RESULT
function Log($m){ $m | Tee-Object -FilePath $RESULT -Append }
$PG = "C:\Program Files\PostgreSQL\17\bin"; $env:PGOPTIONS = "-c client_min_messages=warning"
$DATA = Join-Path $env:TEMP "barber_pg_fin"; $PORT = 55446
$srv = $null; $node = $null
function Cleanup { if ($node){Stop-Process -Id $node.Id -Force -EA SilentlyContinue}; if ($srv){Stop-Process -Id $srv.Id -Force -EA SilentlyContinue}; & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null; Start-Sleep 2; Remove-Item -Recurse -Force $DATA -EA SilentlyContinue }
try {
  if (Test-Path (Join-Path $DATA "postmaster.pid")) { $op=(Get-Content (Join-Path $DATA "postmaster.pid")|Select-Object -First 1); if($op){Stop-Process -Id ([int]$op) -Force -EA SilentlyContinue} }
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -EA SilentlyContinue | ? {$_.CommandLine -like "*barber_pg_fin*"} | % {Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}
  Start-Sleep 2; if(Test-Path $DATA){Remove-Item -Recurse -Force $DATA -EA SilentlyContinue}
  & "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
  $srv = Start-Process -FilePath "$PG\postgres.exe" -ArgumentList @("-D",$DATA,"-p","$PORT") -WindowStyle Hidden -PassThru -RedirectStandardError "$DATA\e.log" -RedirectStandardOutput "$DATA\o.log"
  for($i=0;$i -lt 30;$i++){Start-Sleep 1; & "$PG\psql.exe" -h 127.0.0.1 -p $PORT -U postgres -d postgres -c "SELECT 1;" *>$null; if($LASTEXITCODE -eq 0){break}}
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null
  $env:NODE_ENV="production"; $env:PORT="3000"
  $env:ADMIN_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/barber"
  $env:APP_DATABASE_URL="postgres://barber_app@127.0.0.1:$PORT/barber"
  $env:POSTGRES_USER="barber_app"; $env:POSTGRES_PASSWORD="barber_app_pass"
  $env:MIGRATIONS_DIR="$ROOT\database"; $env:JWT_ACCESS_SECRET="t"; $env:JWT_REFRESH_SECRET="t"; $env:RATE_LIMIT_AUTH="500"
  Remove-Item Env:REDIS_URL -EA SilentlyContinue
  $mig = & node "$BE\db\migrate.js" 2>&1; $mig | ForEach-Object { Log $_ }; if ($LASTEXITCODE -ne 0) { throw "migração falhou" }
  $node = Start-Process -FilePath "node" -ArgumentList @("$BE\src\index.js") -WorkingDirectory $BE -WindowStyle Hidden -PassThru -RedirectStandardOutput "$BE\test\server4.log" -RedirectStandardError "$BE\test\server4.err.log"
  $ready=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try { $r=Invoke-WebRequest "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){$ready=$true;break} } catch {} }
  if (-not $ready) { Get-Content "$BE\test\server4.err.log" -EA SilentlyContinue | % { Log $_ }; throw "backend nao subiu" }
  $env:BASE_URL="http://localhost:3000"
  $o = & node "$BE\test\smoke-financial.mjs" 2>&1; $o | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Log ">>> FALHOU"; Get-Content "$BE\test\server4.err.log" -EA SilentlyContinue | Select-Object -Last 15 | % { Log $_ } }
  else { Log "==================== FINANCEIRO/DASHBOARD: TUDO PASSOU ====================" }
}
catch { Log "ERRO: $_" }
finally { Cleanup }
