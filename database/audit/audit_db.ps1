# ============================================================================
#  AUDITORIA AUTOMATIZADA DO BANCO -sobe Postgres temp, aplica migrações e
#  roda uma bateria de checagens estruturais/segurança. Saída: PASS/RISK/CRIT.
# ============================================================================
$ErrorActionPreference = "Continue"
$DBDIR = "C:\BarberProject\database"
$RESULT = "$DBDIR\audit\audit_db_result.txt"
"" | Set-Content $RESULT
function Log($m){ $m | Tee-Object -FilePath $RESULT -Append }
$PG = "C:\Program Files\PostgreSQL\17\bin"
$env:PGOPTIONS = "-c client_min_messages=warning"
$DATA = Join-Path $env:TEMP "barber_pg_audit"; $PORT = 55442
$psql = @("-h","127.0.0.1","-p","$PORT","-U","postgres","-v","ON_ERROR_STOP=1")
$srv = $null
function Q($sql){ (& "$PG\psql.exe" @psql -d barber -t -A -c $sql) -join "`n" }

try {
  if (Test-Path (Join-Path $DATA "postmaster.pid")) {
    $op=(Get-Content (Join-Path $DATA "postmaster.pid")|Select-Object -First 1); if($op){Stop-Process -Id ([int]$op) -Force -EA SilentlyContinue}
  }
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -EA SilentlyContinue | ? {$_.CommandLine -like "*barber_pg_audit*"} | % {Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}
  Start-Sleep 2; if(Test-Path $DATA){Remove-Item -Recurse -Force $DATA -EA SilentlyContinue}
  & "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
  $srv = Start-Process -FilePath "$PG\postgres.exe" -ArgumentList @("-D",$DATA,"-p","$PORT") -WindowStyle Hidden -PassThru -RedirectStandardError "$DATA\e.log" -RedirectStandardOutput "$DATA\o.log"
  for($i=0;$i -lt 30;$i++){Start-Sleep 1; & "$PG\psql.exe" @psql -d postgres -c "SELECT 1;" *>$null; if($LASTEXITCODE -eq 0){break}}
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null
  foreach($f in @("01_schema.sql","02_triggers.sql","05_improvements.sql","06_extensions.sql","07_whatsapp_crm.sql","08_relational_hardening.sql","09_product_media.sql","10_indexes.sql","03_views.sql")){
    & "$PG\psql.exe" @psql -d barber -f (Join-Path $DBDIR $f) *>$null
  }

  Log "================ AUDITORIA DO BANCO ================"
  Log ("FKs totais: " + (Q "SELECT count(*) FROM pg_constraint WHERE contype='f'"))
  Log ("Policies RLS: " + (Q "SELECT count(*) FROM pg_policies WHERE schemaname='public'"))

  # 1) Órfãs (sem FK in/out) -esperado: só audit_logs
  $orphans = Q @"
SELECT string_agg(c.relname, ', ') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype='f' AND (k.conrelid=c.oid OR k.confrelid=c.oid));
"@
  if ($orphans -eq 'audit_logs' -or $orphans -eq '') { Log "PASS  Tabelas órfãs: [$orphans] (audit_logs é proposital)" }
  else { Log "RISK  Tabelas órfãs inesperadas: [$orphans]" }

  # 2) RLS coverage: tabela com barbershop_id mas SEM row level security
  $norls = Q @"
SELECT string_agg(t.tablename, ', ') FROM pg_tables t
JOIN information_schema.columns col ON col.table_name=t.tablename AND col.table_schema='public' AND col.column_name='barbershop_id'
JOIN pg_class c ON c.relname=t.tablename
WHERE t.schemaname='public' AND c.relrowsecurity=false;
"@
  if ([string]::IsNullOrWhiteSpace($norls)) { Log "PASS  Todas as tabelas com barbershop_id têm RLS habilitada" }
  else { Log "CRIT  Tabelas com barbershop_id SEM RLS: [$norls]" }

  # 3) Tabelas operacionais sem barbershop_id (esperado: só globais conhecidas)
  $nobs = Q @"
SELECT string_agg(t.table_name, ', ') FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
AND t.table_name NOT IN ('plans','accounts','barbershops','users','subscriptions','subscription_payments','auth_sessions','push_subscriptions','audit_logs')
AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.table_schema='public' AND c.column_name='barbershop_id');
"@
  if ([string]::IsNullOrWhiteSpace($nobs)) { Log "PASS  Toda tabela operacional tem barbershop_id" }
  else { Log "RISK  Operacionais sem barbershop_id: [$nobs]" }

  # 4) FKs sem índice de suporte (perf em produção)
  $fkNoIdx = Q @"
SELECT count(*) FROM (
  SELECT c.conrelid, c.conkey[1] AS col FROM pg_constraint c WHERE c.contype='f'
) f
WHERE NOT EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indrelid=f.conrelid AND f.col = ANY(i.indkey)
);
"@
  if ([int]$fkNoIdx -eq 0) { Log "PASS  Todas as FKs têm índice de suporte" }
  else { Log "RISK  $fkNoIdx coluna(s) de FK sem índice (perf). Detalhe abaixo." }
  $fklist = Q @"
SELECT string_agg(conrelid::regclass||'.'||a.attname, ', ')
FROM (SELECT c.conrelid, c.conkey[1] AS col FROM pg_constraint c WHERE c.contype='f') f
JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=f.col
WHERE NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=f.conrelid AND f.col = ANY(i.indkey));
"@
  if (-not [string]::IsNullOrWhiteSpace($fkList)) { Log "      -> $fkList" }

  # 5) Views expondo CUSTO (cost_price) -exposição de dados sensíveis
  $costViews = Q "SELECT string_agg(table_name, ', ') FROM information_schema.views WHERE table_schema='public' AND view_definition ILIKE '%cost_price%';"
  if ([string]::IsNullOrWhiteSpace($costViews)) { Log "PASS  Nenhuma view expõe cost_price" }
  else { Log "CRIT  Views expondo cost_price: [$costViews]" }

  # 6) Funções SECURITY DEFINER (risco de escalonar privilégio / burlar RLS)
  $secdef = Q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef;"
  if ([int]$secdef -eq 0) { Log "PASS  Nenhuma função SECURITY DEFINER (sem bypass de RLS)" }
  else { Log "RISK  $secdef função(ões) SECURITY DEFINER -revisar" }

  # 7) Anti-duplicidade de cliente (unique barbershop_id+phone)
  $dup = Q @"
SELECT count(*) FROM pg_constraint c WHERE c.conrelid='customers'::regclass AND c.contype='u'
AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text) FROM unnest(c.conkey) k JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=k) = ARRAY['barbershop_id','phone']::text[];
"@
  if ([int]$dup -ge 1) { Log "PASS  customers tem UNIQUE(barbershop_id, phone) -anti-duplicidade" }
  else { Log "CRIT  Falta UNIQUE(barbershop_id, phone) em customers" }

  # 8) Anti-overbooking (exclusion constraint) presente
  $excl = Q "SELECT count(*) FROM pg_constraint WHERE conname='excl_no_overlap_per_barber' AND contype='x';"
  if ([int]$excl -ge 1) { Log "PASS  Constraint anti-overbooking (EXCLUDE) presente" }
  else { Log "CRIT  Constraint anti-overbooking ausente" }

  Log "================ FIM ================"
}
catch { Log "ERRO: $_" }
finally {
  if($srv){Stop-Process -Id $srv.Id -Force -EA SilentlyContinue}
  & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null
  Start-Sleep 2; Remove-Item -Recurse -Force $DATA -EA SilentlyContinue
}
