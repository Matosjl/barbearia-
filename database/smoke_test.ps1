# ============================================================================
#  Smoke test do schema Barber SaaS em instância PostgreSQL TEMPORÁRIA
#  Servidor roda DESTACADO (Start-Process); todo o resultado vai para
#  smoke_result.txt dentro do projeto. Limpa tudo no fim.
# ============================================================================
$ErrorActionPreference = "Stop"
$DBDIR  = "C:\BarberProject\database"
$RESULT = Join-Path $DBDIR "smoke_result.txt"
$SRVLOG = Join-Path $DBDIR "smoke_server.log"
"" | Set-Content $RESULT

function Log($m) { $m | Tee-Object -FilePath $RESULT -Append }

function Find-PgBin {
  foreach ($v in @("17","16","15")) {
    $p = "C:\Program Files\PostgreSQL\$v\bin"
    if (Test-Path "$p\initdb.exe") { return $p }
  }
  throw "PostgreSQL bin nao encontrado."
}

$PG    = Find-PgBin
$env:PGOPTIONS = "-c client_min_messages=warning"   # silencia NOTICE/NOTA
$DATA  = Join-Path $env:TEMP "barber_pg_smoke"
$PORT  = 55432
$psqlBase = @("-h","127.0.0.1","-p","$PORT","-U","postgres","-v","ON_ERROR_STOP=1")
$srvProc = $null

Log "PG bin: $PG"
Log "Data dir: $DATA  (porta $PORT)"

try {
  # limpa instancia anterior (robusto: mata postgres preso, ignora ruido)
  $ErrorActionPreference = "Continue"
  if (Test-Path (Join-Path $DATA "postmaster.pid")) {
    $oldPid = (Get-Content (Join-Path $DATA "postmaster.pid") -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
  }
  # mata qualquer postgres.exe rodando com o nosso data dir
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*barber_pg_smoke*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  if (Test-Path $DATA) { Remove-Item -Recurse -Force $DATA -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  $ErrorActionPreference = "Stop"

  # 1) initdb trust
  & "$PG\initdb.exe" -D $DATA -U postgres -A trust --encoding=UTF8 | Out-Null
  Log "initdb OK"

  # 2) start DESTACADO (nao herda o pipe de stdout do shell)
  $srvProc = Start-Process -FilePath "$PG\postgres.exe" `
              -ArgumentList @("-D", $DATA, "-p", "$PORT") `
              -RedirectStandardError $SRVLOG -RedirectStandardOutput "$SRVLOG.out" `
              -WindowStyle Hidden -PassThru

  # 3) espera readiness (ate 30s)
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    & "$PG\psql.exe" @psqlBase -d postgres -c "SELECT 1;" *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  if (-not $ready) { throw "Servidor nao ficou pronto a tempo. Veja $SRVLOG" }
  Log "server pronto (pid $($srvProc.Id))"

  # A partir daqui, NAO deixar stderr nativo do psql virar excecao;
  # validamos sucesso/erro real via $LASTEXITCODE explicitamente.
  $ErrorActionPreference = "Continue"

  # 4) cria DB
  & "$PG\createdb.exe" -h 127.0.0.1 -p $PORT -U postgres barber 2>&1 | Out-Null
  Log "createdb OK"

  # 5) aplica scripts: 01 -> 02 -> 05 -> 03 -> 04
  foreach ($f in @("01_schema.sql","02_triggers.sql","05_improvements.sql","06_extensions.sql","07_whatsapp_crm.sql","08_relational_hardening.sql","09_product_media.sql","10_indexes.sql","03_views.sql","04_seed.sql")) {
    Log "==> aplicando $f"
    $out = & "$PG\psql.exe" @psqlBase -d barber -f (Join-Path $DBDIR $f) 2>&1
    if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Log $_ }; throw "FALHA em $f" }
  }
  Log "TODOS OS SCRIPTS APLICADOS COM SUCESSO"

  function Q($sql) { (& "$PG\psql.exe" @psqlBase -d barber -t -A -c $sql) -join "" }
  Log "`n--- INVENTARIO ---"
  Log ("Tabelas: " + (Q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"))
  Log ("Views:   " + (Q "SELECT count(*) FROM information_schema.views WHERE table_schema='public';"))
  Log ("Triggers:" + (Q "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;"))
  Log ("Policies RLS:" + (Q "SELECT count(*) FROM pg_policies WHERE schemaname='public';"))
  Log ("Indices: " + (Q "SELECT count(*) FROM pg_indexes WHERE schemaname='public';"))

  function RunTest($name, $sql) {
    Log "`n[TESTE] $name"
    $out = & "$PG\psql.exe" @psqlBase -d barber -c $sql 2>&1
    $out | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "TESTE '$name' FALHOU" }
  }

  RunTest "anti-overbooking" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_cust UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  INSERT INTO customers(barbershop_id,name,phone) VALUES (v_shop,'Cliente Teste','+5511000000001') RETURNING id INTO v_cust;
  INSERT INTO appointments(barbershop_id,customer_id,barber_id,starts_at,ends_at,status)
    VALUES (v_shop,v_cust,v_barber, now()+interval '1 day', now()+interval '1 day 30 min','scheduled');
  BEGIN
    INSERT INTO appointments(barbershop_id,customer_id,barber_id,starts_at,ends_at,status)
      VALUES (v_shop,v_cust,v_barber, now()+interval '1 day 15 min', now()+interval '1 day 45 min','scheduled');
  EXCEPTION WHEN exclusion_violation THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: overbooking bloqueado'; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "slot-hold reserva o horario" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_cust UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SELECT id INTO v_cust FROM customers LIMIT 1;
  INSERT INTO appointments(barbershop_id,customer_id,barber_id,starts_at,ends_at,status,hold_expires_at)
    VALUES (v_shop,v_cust,v_barber, now()+interval '2 day', now()+interval '2 day 30 min','pending_hold', now()+interval '5 min');
  BEGIN
    INSERT INTO appointments(barbershop_id,customer_id,barber_id,starts_at,ends_at,status)
      VALUES (v_shop,v_cust,v_barber, now()+interval '2 day 10 min', now()+interval '2 day 40 min','scheduled');
  EXCEPTION WHEN exclusion_violation THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: hold reservou o slot'; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "estoque nao-negativo" @"
DO `$`$
DECLARE v_shop UUID; v_prod UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO products(barbershop_id,name,cost_price,sale_price,stock_qty,min_stock_qty)
    VALUES (v_shop,'Pomada Teste',10,25,5,2) RETURNING id INTO v_prod;
  BEGIN
    INSERT INTO stock_movements(barbershop_id,product_id,movement_type,reason,quantity)
      VALUES (v_shop,v_prod,'out','sale',999);
  EXCEPTION WHEN others THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: venda sem estoque bloqueada'; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "caixa imutavel apos fechado" @"
DO `$`$
DECLARE v_shop UUID; v_user UUID; v_reg UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT u.id INTO v_user FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role='owner' LIMIT 1;
  INSERT INTO cash_registers(barbershop_id,opened_by,opening_amount) VALUES (v_shop,v_user,100) RETURNING id INTO v_reg;
  UPDATE cash_registers SET status='closed', closed_by=v_user, closed_at=now(), counted_cash=100 WHERE id=v_reg;
  BEGIN UPDATE cash_registers SET counted_cash=999 WHERE id=v_reg;
  EXCEPTION WHEN others THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: caixa fechado bloqueou alteracao'; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "RLS isola por tenant" @"
DO `$`$
DECLARE v_shop UUID; v_cnt INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  SELECT count(*) INTO v_cnt FROM services;
  RAISE NOTICE 'tenant correto ve % servicos', v_cnt;
  PERFORM set_config('app.barbershop_id', gen_random_uuid()::text, true);
  SELECT count(*) INTO v_cnt FROM services;
  IF v_cnt = 0 THEN RAISE NOTICE 'PASS: RLS bloqueou tenant errado'; ELSE RAISE EXCEPTION 'FAIL vazou %', v_cnt; END IF;
  RESET ROLE;
END `$`$;
"@

  RunTest "idempotencia de pedido" @"
DO `$`$
DECLARE v_shop UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO orders(barbershop_id,idempotency_key) VALUES (v_shop,'abc-123');
  BEGIN INSERT INTO orders(barbershop_id,idempotency_key) VALUES (v_shop,'abc-123');
  EXCEPTION WHEN unique_violation THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: pedido duplicado bloqueado'; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "expurgo de holds vencidos" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_cust UUID; v_removed INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SELECT id INTO v_cust FROM customers LIMIT 1;
  INSERT INTO appointments(barbershop_id,customer_id,barber_id,starts_at,ends_at,status,hold_expires_at)
    VALUES (v_shop,v_cust,v_barber, now()+interval '3 day', now()+interval '3 day 30 min','pending_hold', now()-interval '1 min');
  SELECT fn_expire_slot_holds() INTO v_removed;
  IF v_removed >= 1 THEN RAISE NOTICE 'PASS: % hold(s) vencido(s) expurgado(s)', v_removed; ELSE RAISE EXCEPTION 'FAIL'; END IF;
END `$`$;
"@

  RunTest "RBAC barbeiro so ve os proprios agendamentos" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_self INT; v_other INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  PERFORM set_config('app.role', 'barber', true);
  PERFORM set_config('app.barber_id', v_barber::text, true);
  SELECT count(*) INTO v_self FROM appointments;
  PERFORM set_config('app.barber_id', gen_random_uuid()::text, true);
  SELECT count(*) INTO v_other FROM appointments;
  RESET ROLE;
  IF v_other = 0 THEN RAISE NOTICE 'PASS: barbeiro ve % proprios e 0 de outro', v_self;
  ELSE RAISE EXCEPTION 'FAIL: vazou % agendamentos de outro barbeiro', v_other; END IF;
END `$`$;
"@

  RunTest "RBAC barbeiro NAO acessa financeiro/estoque" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_fin INT; v_stock INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  PERFORM set_config('app.role', 'barber', true);
  PERFORM set_config('app.barber_id', v_barber::text, true);
  SELECT count(*) INTO v_fin FROM financial_transactions;
  SELECT count(*) INTO v_stock FROM products;
  RESET ROLE;
  IF v_fin = 0 AND v_stock = 0 THEN RAISE NOTICE 'PASS: financeiro/estoque ocultos ao barbeiro';
  ELSE RAISE EXCEPTION 'FAIL: barbeiro viu fin=% estoque=%', v_fin, v_stock; END IF;
END `$`$;
"@

  RunTest "auto-tags aplicam etiquetas por regra" @"
DO `$`$
DECLARE v_shop UUID; v_cust UUID; v_tags INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO customers(barbershop_id,name,phone,visits_count,total_spent,is_verified)
    VALUES (v_shop,'Cliente Fiel VIP','+5511000000777',12,600,TRUE) RETURNING id INTO v_cust;
  PERFORM fn_recompute_customer_tags(v_shop);
  SELECT count(*) INTO v_tags FROM customer_tag_assignments WHERE customer_id=v_cust;
  IF v_tags >= 3 THEN RAISE NOTICE 'PASS: % etiquetas auto aplicadas (fiel/vip/verificado)', v_tags;
  ELSE RAISE EXCEPTION 'FAIL: esperava >=3 etiquetas, veio %', v_tags; END IF;
END `$`$;
"@

  RunTest "opt-out exclui da audiencia de campanha" @"
DO `$`$
DECLARE v_shop UUID; v_cust UUID; v_in INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO customers(barbershop_id,name,phone,marketing_opt_out)
    VALUES (v_shop,'Cliente OptOut','+5511000000888',TRUE) RETURNING id INTO v_cust;
  SELECT count(*) INTO v_in FROM vw_campaign_audience WHERE customer_id=v_cust;
  IF v_in = 0 THEN RAISE NOTICE 'PASS: opt-out fora da audiencia';
  ELSE RAISE EXCEPTION 'FAIL: opt-out apareceu na audiencia'; END IF;
END `$`$;
"@

  RunTest "barbeiro NAO dispara campanha em massa" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  PERFORM set_config('app.role', 'barber', true);
  PERFORM set_config('app.barber_id', v_barber::text, true);
  BEGIN
    INSERT INTO marketing_campaigns(barbershop_id,name,target_segment,message_template)
      VALUES (v_shop,'Campanha Proibida','inactive','oi');
  EXCEPTION WHEN others THEN v_ok := TRUE;
  END;
  RESET ROLE;
  IF v_ok THEN RAISE NOTICE 'PASS: barbeiro bloqueado de criar campanha';
  ELSE RAISE EXCEPTION 'FAIL: barbeiro criou campanha'; END IF;
END `$`$;
"@

  RunTest "barbeiro sem permissao nao ve conversas WhatsApp" @"
DO `$`$
DECLARE v_shop UUID; v_barber UUID; v_cust UUID; v_n INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  SELECT id INTO v_barber FROM barbers LIMIT 1;
  SELECT id INTO v_cust FROM customers LIMIT 1;
  INSERT INTO whatsapp_conversations(barbershop_id,customer_id) VALUES (v_shop,v_cust);
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  PERFORM set_config('app.role', 'barber', true);
  PERFORM set_config('app.barber_id', v_barber::text, true);
  SELECT count(*) INTO v_n FROM whatsapp_conversations;
  RESET ROLE;
  IF v_n = 0 THEN RAISE NOTICE 'PASS: sem allow_barber_whatsapp, barbeiro ve 0 conversas';
  ELSE RAISE EXCEPTION 'FAIL: barbeiro viu % conversas', v_n; END IF;
END `$`$;
"@

  RunTest "cliente VE produtos vendaveis no Shop (correcao 09)" @"
DO `$`$
DECLARE v_shop UUID; v_prod UUID; v_seen INT;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO products(barbershop_id,name,sale_price,stock_qty,is_sellable,is_active)
    VALUES (v_shop,'Pomada Shop',49.9,10,TRUE,TRUE) RETURNING id INTO v_prod;
  INSERT INTO product_viewer_settings(barbershop_id,product_id,auto_rotate,rotation_speed)
    VALUES (v_shop,v_prod,TRUE,1.5);
  INSERT INTO product_media(barbershop_id,product_id,media_type,file_url,display_order)
    VALUES (v_shop,v_prod,'front','https://x/f.png',0),(v_shop,v_prod,'back','https://x/b.png',1);
  SET LOCAL ROLE barber_app;
  PERFORM set_config('app.barbershop_id', v_shop::text, true);
  PERFORM set_config('app.role', 'customer', true);
  PERFORM set_config('app.customer_id', gen_random_uuid()::text, true);
  SELECT count(*) INTO v_seen FROM vw_shop_products WHERE product_id = v_prod;
  RESET ROLE;
  IF v_seen = 1 THEN RAISE NOTICE 'PASS: cliente ve o produto no Shop via vw_shop_products';
  ELSE RAISE EXCEPTION 'FAIL: cliente nao viu o produto no Shop'; END IF;
END `$`$;
"@

  RunTest "360: 1 angulo por produto (unicidade)" @"
DO `$`$
DECLARE v_shop UUID; v_prod UUID; v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shop FROM barbershops LIMIT 1;
  INSERT INTO products(barbershop_id,name,sale_price,stock_qty) VALUES (v_shop,'Oleo 360',30,5) RETURNING id INTO v_prod;
  INSERT INTO product_media(barbershop_id,product_id,media_type,file_url) VALUES (v_shop,v_prod,'front','u1');
  BEGIN
    INSERT INTO product_media(barbershop_id,product_id,media_type,file_url) VALUES (v_shop,v_prod,'front','u2');
  EXCEPTION WHEN unique_violation THEN v_ok := TRUE; END;
  IF v_ok THEN RAISE NOTICE 'PASS: angulo front nao duplica';
  ELSE RAISE EXCEPTION 'FAIL: duplicou angulo'; END IF;
END `$`$;
"@

  Log "`n==================== SMOKE TEST: TUDO PASSOU ===================="
}
catch {
  Log "ERRO: $_"
}
finally {
  if ($srvProc -ne $null) { Stop-Process -Id $srvProc.Id -Force -ErrorAction SilentlyContinue }
  & "$PG\pg_ctl.exe" -D $DATA stop -m immediate 2>$null | Out-Null
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $DATA -ErrorAction SilentlyContinue
  Remove-Item -Force $SRVLOG,"$SRVLOG.out" -ErrorAction SilentlyContinue
  Log "instancia temporaria removida"
}
