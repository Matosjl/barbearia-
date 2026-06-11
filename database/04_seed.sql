-- ============================================================================
--  BARBER SAAS — SEED MÍNIMO (planos + barbearia demo)
-- ============================================================================

-- Planos SaaS
INSERT INTO plans (code, name, max_barbers, max_units, monthly_price, features) VALUES
 ('basic',   'Básico',        1,  1,  49.90,  '{"reports":"basic","loyalty":false}'),
 ('pro',     'Profissional',  5,  1,  99.90,  '{"reports":"advanced","loyalty":true}'),
 ('premium', 'Premium',     NULL, 99, 199.90, '{"reports":"advanced","loyalty":true,"multi_unit":true}')
ON CONFLICT (code) DO NOTHING;

-- Conta + barbearia demo
DO $$
DECLARE
  v_plan UUID;  v_account UUID;  v_shop UUID;
  v_owner UUID; v_barber_user UUID; v_barber UUID;
  v_cat UUID;   v_svc_corte UUID;  v_svc_barba UUID;
BEGIN
  SELECT id INTO v_plan FROM plans WHERE code='pro';

  INSERT INTO accounts(legal_name, plan_id, status, trial_ends_at)
  VALUES ('Barbearia Demo LTDA', v_plan, 'trial', now() + INTERVAL '14 days')
  RETURNING id INTO v_account;

  INSERT INTO barbershops(account_id, name, slug, welcome_message, timezone, slot_interval_minutes)
  VALUES (v_account, 'Barbearia do Rei', 'barbearia-do-rei',
          'Bem-vindo! Agende seu horário em segundos.', 'America/Sao_Paulo', 30)
  RETURNING id INTO v_shop;

  -- horário de funcionamento: terça a sábado 09:00-19:00
  INSERT INTO business_hours(barbershop_id, weekday, opens_at, closes_at)
  SELECT v_shop, d, TIME '09:00', TIME '19:00' FROM generate_series(2,6) d;

  -- formas de pagamento
  INSERT INTO payment_methods(barbershop_id, method, fee_percentage) VALUES
   (v_shop,'cash',0),(v_shop,'pix',0),(v_shop,'debit',1.5),(v_shop,'credit',3.5);

  -- config de no-show: bloqueio após 3 faltas
  INSERT INTO settings(barbershop_id, key, value)
  VALUES (v_shop,'no_show_block_threshold','{"value":3}');

  -- dono
  INSERT INTO users(name, email, password_hash)
  VALUES ('Rei (Dono)', 'sealorin@gmail.com', '$2b$10$placeholderhashplaceholderhashplaceholde')
  RETURNING id INTO v_owner;
  INSERT INTO memberships(user_id, barbershop_id, role) VALUES (v_owner, v_shop, 'owner');

  -- barbeiro
  INSERT INTO users(name, phone) VALUES ('Carlos', '+5511999990000') RETURNING id INTO v_barber_user;
  INSERT INTO memberships(user_id, barbershop_id, role) VALUES (v_barber_user, v_shop, 'barber');
  INSERT INTO barbers(barbershop_id, user_id, display_name, default_service_commission_pct)
  VALUES (v_shop, v_barber_user, 'Carlos', 50) RETURNING id INTO v_barber;
  INSERT INTO barber_schedules(barbershop_id, barber_id, weekday, starts_at, ends_at)
  SELECT v_shop, v_barber, d, TIME '09:00', TIME '19:00' FROM generate_series(2,6) d;

  -- serviços
  INSERT INTO service_categories(barbershop_id, name) VALUES (v_shop,'Cabelo & Barba') RETURNING id INTO v_cat;
  INSERT INTO services(barbershop_id, category_id, name, duration_minutes, price)
  VALUES (v_shop, v_cat, 'Corte', 30, 40.00) RETURNING id INTO v_svc_corte;
  INSERT INTO services(barbershop_id, category_id, name, duration_minutes, price)
  VALUES (v_shop, v_cat, 'Barba', 20, 25.00) RETURNING id INTO v_svc_barba;
  INSERT INTO barber_services(barbershop_id, barber_id, service_id) VALUES
   (v_shop, v_barber, v_svc_corte),(v_shop, v_barber, v_svc_barba);

  -- programa de fidelidade: 10 cortes -> 1 grátis
  INSERT INTO loyalty_programs(barbershop_id, is_active, required_count, reward_service_id)
  VALUES (v_shop, TRUE, 10, v_svc_corte);

  RAISE NOTICE 'Seed concluído. Barbershop=%, Owner=%, Barber=%', v_shop, v_owner, v_barber;
END $$;
