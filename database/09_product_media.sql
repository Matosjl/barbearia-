-- ============================================================================
--  BARBER SAAS — MIGRAÇÃO 09: VISUALIZADOR 360° DO PRODUTO + AJUSTE DO SHOP
--    - product_media: fotos por ângulo (front/back/left/right/top/bottom/video)
--    - product_viewer_settings: configura o visualizador 360° por produto
--    - Correção: cliente precisa VER produtos vendáveis no Shop (a 06 bloqueava)
--  Depende de: 01..08.  Ordem: ... → 08 → 09 → 03 → 04
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MÍDIA DO PRODUTO (galeria multiângulo p/ o visualizador 360°)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_media (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id UUID NOT NULL REFERENCES barbershops(id),
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    media_type    TEXT NOT NULL CHECK (media_type IN ('front','back','left','right','top','bottom','video','extra')),
    file_url      TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);
-- um ângulo único por produto (vídeo/extra podem repetir)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_media_angle
    ON product_media (product_id, media_type)
    WHERE media_type NOT IN ('video','extra') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_media_product ON product_media(product_id, display_order);

-- ----------------------------------------------------------------------------
-- 2. CONFIGURAÇÃO DO VISUALIZADOR 360° (1 por produto)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_viewer_settings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barbershop_id     UUID NOT NULL REFERENCES barbershops(id),
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    auto_rotate       BOOLEAN NOT NULL DEFAULT TRUE,
    rotation_speed    NUMERIC(5,2) NOT NULL DEFAULT 1.0 CHECK (rotation_speed > 0),  -- voltas/min relativo
    zoom_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    background_style  TEXT NOT NULL DEFAULT 'dark_premium'
                        CHECK (background_style IN ('transparent','dark_premium','neon','light')),
    reflection_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    particle_effect   BOOLEAN NOT NULL DEFAULT FALSE,
    neon_color        TEXT DEFAULT '#7c3aed',     -- combina com a identidade da barbearia
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id)
);

-- updated_at + auditoria
DROP TRIGGER IF EXISTS trg_product_viewer_settings_updated_at ON product_viewer_settings;
CREATE TRIGGER trg_product_viewer_settings_updated_at BEFORE UPDATE ON product_viewer_settings
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_product_media_audit ON product_media;
CREATE TRIGGER trg_product_media_audit AFTER INSERT OR UPDATE OR DELETE ON product_media
  FOR EACH ROW EXECUTE FUNCTION fn_audit();

-- ----------------------------------------------------------------------------
-- 3. CORREÇÃO DE VISIBILIDADE DO SHOP
--    A migração 06 negou 'products' e 'product_categories' para barber/customer
--    (para esconder lucro/estoque). Mas o CLIENTE precisa ver o catálogo do Shop.
--    Ajuste: cliente/barbeiro enxergam apenas produtos VENDÁVEIS e ATIVOS.
--    Colunas sensíveis (cost_price, stock_qty) NÃO são expostas ao cliente:
--    o app/cliente consome a view vw_shop_products (só colunas seguras).
-- ----------------------------------------------------------------------------

-- 3.1 products: o CLIENTE vê vendável+ativo (Shop). Barbeiro comissionado NÃO
--     acessa estoque/produtos (regra do dono). Staff gerencia tudo.
DROP POLICY IF EXISTS deny_barber_customer ON products;
DROP POLICY IF EXISTS shop_visibility ON products;
CREATE POLICY shop_visibility ON products AS RESTRICTIVE
  USING (
    app_role() IN ('owner','manager','receptionist')
    OR (app_role() = 'customer'
        AND is_sellable = TRUE AND is_active = TRUE AND deleted_at IS NULL)
  )
  WITH CHECK ( app_role() IN ('owner','manager','receptionist') );  -- escrita só staff

-- 3.2 product_categories: leitura liberada no tenant (necessária p/ filtros do Shop),
--     escrita apenas staff.
DROP POLICY IF EXISTS deny_barber_customer ON product_categories;
DROP POLICY IF EXISTS category_visibility ON product_categories;
CREATE POLICY category_visibility ON product_categories AS RESTRICTIVE
  USING (TRUE)
  WITH CHECK ( app_role() IN ('owner','manager','receptionist') );

-- (stock_movements e service_supplies CONTINUAM negados a barber/customer — internos)

-- ----------------------------------------------------------------------------
-- 4. VIEW DO SHOP (colunas seguras: sem custo/estoque interno) + mídia agregada
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_shop_products AS
SELECT
    p.barbershop_id,
    p.id AS product_id,
    p.category_id,
    p.name,
    p.description,
    p.photo_url,
    p.sale_price,
    (p.stock_qty > 0) AS in_stock,             -- só disponibilidade, não o saldo
    COALESCE(vs.auto_rotate, TRUE)        AS auto_rotate,
    COALESCE(vs.rotation_speed, 1.0)      AS rotation_speed,
    COALESCE(vs.zoom_enabled, TRUE)       AS zoom_enabled,
    COALESCE(vs.background_style,'dark_premium') AS background_style,
    COALESCE(vs.reflection_enabled, TRUE) AS reflection_enabled,
    COALESCE(vs.particle_effect, FALSE)   AS particle_effect,
    vs.neon_color,
    ARRAY(
      SELECT json_build_object('type', m.media_type, 'url', m.file_url, 'order', m.display_order)::text
        FROM product_media m
       WHERE m.product_id = p.id AND m.deleted_at IS NULL
       ORDER BY m.display_order
    ) AS media
FROM products p
LEFT JOIN product_viewer_settings vs ON vs.product_id = p.id
WHERE p.is_sellable = TRUE AND p.is_active = TRUE AND p.deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 5. RLS / grants nas novas tabelas (tenant isolation + leitura no Shop)
--    product_media e product_viewer_settings: leitura liberada no tenant
--    (são imagens/efeitos do catálogo); escrita só staff (app valida).
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_name=c.table_name AND tb.table_schema=c.table_schema
     WHERE c.table_schema='public' AND c.column_name='barbershop_id' AND tb.table_type='BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (barbershop_id = app_current_barbershop())
        WITH CHECK (barbershop_id = app_current_barbershop());
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO barber_app;', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barber_app;

-- escrita de mídia/visualizador apenas staff (cliente/barbeiro só leem)
-- cliente lê (Shop), staff escreve, barbeiro comissionado não acessa
ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_no_barber_write_staff ON product_media;
DROP POLICY IF EXISTS write_staff_only ON product_media;
CREATE POLICY read_no_barber_write_staff ON product_media AS RESTRICTIVE
  USING ( app_role() <> 'barber' )
  WITH CHECK ( app_role() IN ('owner','manager','receptionist') );

ALTER TABLE product_viewer_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_no_barber_write_staff ON product_viewer_settings;
DROP POLICY IF EXISTS write_staff_only ON product_viewer_settings;
CREATE POLICY read_no_barber_write_staff ON product_viewer_settings AS RESTRICTIVE
  USING ( app_role() <> 'barber' )
  WITH CHECK ( app_role() IN ('owner','manager','receptionist') );

-- ============================================================================
--  Resultado: cada produto pode ter galeria 360° (product_media) + efeitos
--  (product_viewer_settings); o Shop do cliente lê tudo por vw_shop_products,
--  sem expor custo/estoque. Frontend: features/client/Shop/Product360Viewer.
-- ============================================================================
