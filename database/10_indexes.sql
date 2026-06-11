-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 10: ÍNDICES DE SUPORTE A FOREIGN KEYS
--  Auditoria pré-produção apontou 85 colunas de FK sem índice (risco de perf
--  em produção: joins/filtros e checagens de RLS por barbershop_id ficam lentos
--  e DELETEs em pais fazem varredura no filho). Criados de forma idempotente.
--  Ordem: ... → 09 → 10 → 03 (views)
-- ============================================================================

-- SaaS / conta
CREATE INDEX IF NOT EXISTS idx_accounts_plan ON accounts(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_sub ON subscription_payments(subscription_id);

-- barbeiros / agenda
CREATE INDEX IF NOT EXISTS idx_barbers_user ON barbers(user_id);
CREATE INDEX IF NOT EXISTS idx_barber_schedules_shop ON barber_schedules(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_barber_time_off_shop ON barber_time_off(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_barber_services_shop ON barber_services(barbershop_id);

-- serviços / insumos
CREATE INDEX IF NOT EXISTS idx_service_categories_shop ON service_categories(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_service_supplies_shop ON service_supplies(barbershop_id);

-- produtos / estoque
CREATE INDEX IF NOT EXISTS idx_product_categories_shop ON product_categories(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_shop ON stock_movements(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_performed_by ON stock_movements(performed_by);
CREATE INDEX IF NOT EXISTS idx_stock_movements_appointment ON stock_movements(appointment_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements(order_id);

-- clientes / favoritos / etiquetas / consentimento
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer ON customer_favorites(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_favorites_barber ON customer_favorites(barber_id);
CREATE INDEX IF NOT EXISTS idx_customer_favorites_service ON customer_favorites(service_id);
CREATE INDEX IF NOT EXISTS idx_tag_assign_assigned_by ON customer_tag_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tag_assign_shop ON customer_tag_assignments(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_consent_shop ON customer_consent_history(barbershop_id);

-- agendamentos
CREATE INDEX IF NOT EXISTS idx_appointments_canceled_by ON appointments(canceled_by);
CREATE INDEX IF NOT EXISTS idx_appointments_created_by ON appointments(created_by);
CREATE INDEX IF NOT EXISTS idx_appointment_items_shop ON appointment_items(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_appointment_items_service ON appointment_items(service_id);
CREATE INDEX IF NOT EXISTS idx_appt_status_hist_changed_by ON appointment_status_history(changed_by);

-- pedidos / Shop
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_barber ON orders(barber_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_order_items_shop ON order_items(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- fidelidade
CREATE INDEX IF NOT EXISTS idx_loyalty_mov_appointment ON loyalty_movements(appointment_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_programs_reward ON loyalty_programs(reward_service_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_shop ON loyalty_cards(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_mov_shop ON loyalty_movements(barbershop_id);

-- caixa
CREATE INDEX IF NOT EXISTS idx_cash_registers_opened_by ON cash_registers(opened_by);
CREATE INDEX IF NOT EXISTS idx_cash_registers_closed_by ON cash_registers(closed_by);
CREATE INDEX IF NOT EXISTS idx_payments_cash_register ON payments(cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shop ON cash_movements(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_performed_by ON cash_movements(performed_by);

-- financeiro
CREATE INDEX IF NOT EXISTS idx_expense_categories_shop ON expense_categories(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_expense_cat ON financial_transactions(expense_category_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_appointment ON financial_transactions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_order ON financial_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_payment ON financial_transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_cash_register ON financial_transactions(cash_register_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_reverses ON financial_transactions(reverses_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_performed_by ON financial_transactions(performed_by);
CREATE INDEX IF NOT EXISTS idx_fin_tx_commission ON financial_transactions(commission_id);

-- comissão
CREATE INDEX IF NOT EXISTS idx_commission_rules_service ON commission_rules(service_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_prodcat ON commission_rules(product_category_id);
CREATE INDEX IF NOT EXISTS idx_commissions_shop ON commissions(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_commissions_appt_item ON commissions(appointment_item_id);
CREATE INDEX IF NOT EXISTS idx_commissions_order_item ON commissions(order_item_id);
CREATE INDEX IF NOT EXISTS idx_commissions_payout ON commissions(payout_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_shop ON commission_payouts(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_paid_by ON commission_payouts(paid_by);

-- metas / avaliações
CREATE INDEX IF NOT EXISTS idx_goals_barber ON goals(barber_id);
CREATE INDEX IF NOT EXISTS idx_reviews_shop ON reviews(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON reviews(customer_id);

-- marketing / campanhas
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON marketing_campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_shop ON marketing_campaigns(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_ai_suggestion ON marketing_campaigns(ai_suggestion_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_approved_by ON marketing_campaigns(approved_by);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_message ON campaign_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_shop ON campaign_recipients(barbershop_id);

-- notificações / push
CREATE INDEX IF NOT EXISTS idx_notifications_shop ON notifications(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- IA
CREATE INDEX IF NOT EXISTS idx_ai_jobs_shop ON ai_jobs(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_customer ON ai_suggestions(customer_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_reviewed_by ON ai_suggestions(reviewed_by);

-- WhatsApp
CREATE INDEX IF NOT EXISTS idx_wa_msg_customer ON whatsapp_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_appointment ON whatsapp_messages(appointment_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_created_by ON whatsapp_messages(created_by);

-- timeline (feed conectado a tudo)
CREATE INDEX IF NOT EXISTS idx_timeline_actor ON timeline_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_appointment ON timeline_events(appointment_id);
CREATE INDEX IF NOT EXISTS idx_timeline_order ON timeline_events(order_id);
CREATE INDEX IF NOT EXISTS idx_timeline_payment ON timeline_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_timeline_product ON timeline_events(product_id);
CREATE INDEX IF NOT EXISTS idx_timeline_campaign ON timeline_events(campaign_id);

-- visualizador 360
CREATE INDEX IF NOT EXISTS idx_product_media_shop ON product_media(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_product_viewer_settings_shop ON product_viewer_settings(barbershop_id);
