# Design & Wireframe — Barber SaaS (mobile-first)

Referência visual oficial: o wireframe "FLUXO DO CLIENTE" enviado pelo Rei (jornada completa do app). Este documento formaliza o design system extraído dele e mapeia as telas para os módulos/endpoints já definidos. **Tudo é mobile-first** (uso principal no celular), com PWA instalável e versão desktop responsiva.

## Identidade visual (do wireframe)

- **Tema escuro premium** com **neon** roxo/ciano e **glassmorphism** (cartões translúcidos com blur).
- Gradientes roxo→azul nos botões primários; bordas sutis iluminadas.
- Tipografia limpa, hierarquia forte (títulos grandes, labels discretos).
- Cada barbearia define sua **cor de destaque** (neon) — já previsto em `product_viewer_settings.neon_color` e no tema da barbearia.

## Telas da área do cliente (mapeadas a features/endpoints)

1. **Entrada** — logo neon, "Sua barbearia na palma da mão", Entrar / Criar conta / Continuar como convidado. → `auth`
2. **Cadastro/Login** — nome, WhatsApp (DDD), e-mail, senha. → `POST /auth/register`, `POST /auth/login` (login por telefone)
3. **Home** — saudação, "Agendar horário", "Escolher serviços", promoções, próximos horários, **bottom-nav** (Início/Agendamentos/Shop/Perfil). → dashboard do cliente
4. **Escolher serviço** — lista com preço e duração, seleção (Corte+Barba). → `GET /services`
5. **Escolher barbeiro** — cards com foto, nota e especialidade. → `GET /barbers`
6. **Escolher horário** — calendário + slots; **slot-hold** ao tocar. → `GET /availability`, `POST /appointments/hold`
7. **Confirmação** — resumo (serviço/barbeiro/data/hora/valor), adicionar ao calendário. → `PATCH /appointments/{id}/confirm`
8. **Outras áreas** — Agendamentos, Shop, Fidelidade, Promoções, Perfil.
9. **Shop** — busca, filtros por categoria, produtos em destaque, card de produto, **carrinho**, finalizar compra (Pix/Cartão), pedido confirmado com código. → `GET /shop/products` (`vw_shop_products`), `orders`

Menu inferior (mobile): **Início · Shop · Histórico/Agendamentos · Perfil** — exatamente como no wireframe.

## Painel (dono/gerente) e versão do barbeiro

- **Dono**: dashboard executivo, agenda/clientes agendados, financeiro, caixa, estoque, comissões, CRM, **Central WhatsApp**, campanhas, IA, relatórios.
- **Barbeiro comissionado**: versão **restrita** — só os próprios agendamentos, atendimentos, comissões, "a receber", clientes que atendeu e "+ Lançar cliente na hora". Sem financeiro/lucro/estoque/config (garantido por RLS).
- **Recepção**: agenda + caixa, sem estratégico.

## Visualizador 360° do produto (Shop premium)

Modelado em `09_product_media.sql`:

- **`product_media`** — fotos por ângulo: `front, back, left, right, top, bottom, video, extra` (+ `display_order`). Um ângulo único por produto (vídeo/extra podem repetir).
- **`product_viewer_settings`** — por produto: `auto_rotate`, `rotation_speed`, `zoom_enabled`, `background_style` (transparent/dark_premium/neon/light), `reflection_enabled`, `particle_effect`, `neon_color`.
- O Shop do cliente consome **`vw_shop_products`** (já agrega mídia + settings, sem expor custo/estoque).
- Componente front: `apps/frontend/src/features/client/Shop/Product360Viewer.tsx`.

### Como funciona o 360° a partir das fotos

Com 4–6 fotos (frente/trás/lados/topo/base), o viewer monta uma sequência e simula rotação (sprite rotation). Com mais fotos, a rotação fica mais suave; com vídeo, usa o `video`. Efeitos (reflexo, glassmorphism, partículas, neon) vêm das settings.

### Prompt para o Antigravity (gerar o componente do viewer)

Modelo pronto — basta anexar a imagem do produto e ajustar a cor neon da barbearia:

> Crie um componente React (mobile-first, depois desktop) de **visualizador 360° de produto premium** para um app de barbearia. Receba um array de imagens por ângulo (front, back, left, right, top, bottom) e um objeto de settings (auto_rotate, rotation_speed, zoom_enabled, background_style, reflection_enabled, particle_effect, neon_color). Requisitos visuais: **rotação 360° automática lenta e contínua**, arrastar para girar manualmente, **zoom ao tocar/pinçar**, **fundo escuro premium** com opção neon/transparente, **reflexo** do produto no "chão", **iluminação cinematográfica** com luz dinâmica seguindo a rotação, **glassmorphism** no painel de controles, **sombras** suaves, **partículas** sutis opcionais, **destaque neon** na cor {neon_color} combinando com a identidade. Animações: **entrada elegante** (fade+scale), **hover** no desktop, **loading** com shimmer, e micro-animação no botão **"Adicionar ao carrinho"** (pulso + check). Otimize a animação para mobile (60fps, sem travar) e para desktop. Use CSS/Canvas/WebGL conforme melhor desempenho. Entregue o componente isolado e estilizado, com props tipadas.

## Acessibilidade e PWA

- Contraste suficiente apesar do tema escuro (texto claro sobre fundo escuro).
- Alvos de toque ≥ 44px (bottom-nav, botões).
- PWA: manifest + service worker (instalável, ícone, splash), offline básico para telas já visitadas.

> O wireframe enviado é a fonte visual; as telas acima já correspondem 1:1 aos fluxos e endpoints documentados em `FLUXOS-OPERACIONAIS.md`.
