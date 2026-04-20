import streamlit as st
import streamlit.components.v1 as components

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(
    page_title="Barber Pro Luxury - Gestão Completa para Barbearias",
    page_icon="💈",
    layout="wide",
    initial_sidebar_state="collapsed" # Esconde a barra lateral padrão
)

# --- CSS PROFISSIONAL (ESTILO LANDING PAGE) ---
def local_css(file_name):
    with open(file_name) as f:
        st.markdown(f'<style>{f.read()}</style>', unsafe_allow_html=True)

# CSS Inline para não precisar de arquivo externo
st.markdown("""
<style>
    /* Remove o menu e rodapé padrão do Streamlit */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* Cores do Tema */
    :root {
        --gold: #D4AF37;
        --dark-bg: #0E1117;
        --card-bg: #15191E;
    }

    /* Estilo Base */
    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
        background-color: var(--dark-bg);
        color: #FFFFFF;
    }

    /* Hero Section */
    .hero-container {
        padding: 4rem 2rem;
        text-align: center;
        background: linear-gradient(180deg, #0E1117 0%, #1a1f26 100%);
    }
    
    .hero-title {
        font-size: 3.5rem;
        font-weight: 800;
        color: #FFFFFF;
        margin-bottom: 0.5rem;
    }

    .hero-subtitle {
        font-size: 1.5rem;
        color: #D4AF37;
        margin-bottom: 2rem;
    }

    .hero-description {
        font-size: 1.2rem;
        color: #CCCCCC;
        max-width: 800px;
        margin: 0 auto 3rem auto;
    }

    /* Botão CTA Principal */
    .stButton > button {
        background-color: var(--gold);
        color: black;
        font-size: 1.2rem;
        font-weight: bold;
        padding: 15px 40px;
        border-radius: 50px;
        border: none;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
    }

    .stButton > button:hover {
        background-color: #FFFFFF;
        color: black;
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(212, 175, 55, 0.5);
    }

    /* Seção de Features */
    .feature-card {
        background-color: var(--card-bg);
        padding: 2rem;
        border-radius: 15px;
        border: 1px solid #2a2e35;
        height: 100%;
        transition: transform 0.3s;
    }
    
    .feature-card:hover {
        transform: translateY(-5px);
        border-color: var(--gold);
    }

    .feature-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
    }

    .feature-title {
        color: var(--gold);
        font-size: 1.5rem;
        font-weight: bold;
        margin-bottom: 0.5rem;
    }

    /* Seção de Preços */
    .price-card {
        background-color: var(--card-bg);
        padding: 2rem;
        border-radius: 15px;
        text-align: center;
        border: 1px solid #2a2e35;
    }

    .price-highlight {
        border: 2px solid var(--gold);
        transform: scale(1.05);
    }

    /* Footer */
    .footer {
        text-align: center;
        padding: 3rem;
        color: #888;
        border-top: 1px solid #2a2e35;
        margin-top: 4rem;
    }

</style>
""", unsafe_allow_html=True)

# --- LAYOUT DA LANDING PAGE ---

# 1. HERO SECTION
st.markdown('<div class="hero-container">', unsafe_allow_html=True)
st.markdown('<div class="hero-title"> barber Pro Luxury </div>', unsafe_allow_html=True)
st.markdown('<div class="hero-subtitle"> O Sistema de Gestão Definitivo para sua Barbearia </div>', unsafe_allow_html=True)
st.markdown('<div class="hero-description"> Pare de perder dinheiro com planilhas e papéis. Controle sua agenda, estoque com cálculo de lucro real e comissões de forma automática e elegante. </div>', unsafe_allow_html=True)

# Botão de Chamada para Ação
link_whatsapp = "https://wa.me/5511999999999?text=Olá! Quero saber mais sobre o Barber Pro Luxury."
st.link_button("💈 QUERO TESTAR GRÁTIS AGORA", link_whatsapp, type="primary")

st.markdown('</div>', unsafe_allow_html=True)

# Espaçamento
st.write("\n" * 4)

# 2. SEÇÃO: PROBLEMAS vs SOLUÇÕES (BENEFÍCIOS)
st.markdown("<h2 style='text-align: center; color: #D4AF37;'>Por que barbeiros escolhem o Barber Pro?</h2>", unsafe_allow_html=True)
st.write("\n")

c1, c2, c3 = st.columns(3)

with c1:
    st.markdown("""
    <div class="feature-card">
        <div class="feature-icon">📉</div>
        <div class="feature-title">Fim do Prejuízo</div>
        <p>Sabia exatamente quanto lucrou em cada produto vendido. Nosso sistema calcula automaticamente o <strong>Custo x Venda</strong> e mostra seu lucro real.</p>
    </div>
    """, unsafe_allow_html=True)

with c2:
    st.markdown("""
    <div class="feature-card">
        <div class="feature-icon">📅</div>
        <div class="feature-title">Agenda Organizada</div>
        <p>Nunca mais esqueça um cliente. Gerencie agendamentos, cancele ou remarque com facilidade e vincule serviços diretamente aos barbeiros.</p>
    </div>
    """, unsafe_allow_html=True)

with c3:
    st.markdown("""
    <div class="feature-card">
        <div class="feature-icon">💰</div>
        <div class="feature-title">Comissões Automáticas</div>
        <p>Saia do papel. O sistema calcula a comissão 50/50 (ou a que você definir) de cada barbeiro e gera relatórios diários, semanais e mensais.</p>
    </div>
    """, unsafe_allow_html=True)

st.write("\n" * 2)

# 3. FUNCIONALIDADES DETALHADAS (Vínculo com o código criado)
st.markdown("<h2 style='text-align: center; color: #FFFFFF;'>Tudo o que você precisa em um só lugar</h2>", unsafe_allow_html=True)
st.write("\n")

f1, f2 = st.columns(2)

with f1:
    st.markdown("""
    #### ✂️ Gestão de Atendimento
    *   Finalize serviços com opções de pagamento (Dinheiro, Pix, Cartão).
    *   Vincule clientes da agenda automaticamente.
    *   Histórico completo de todos os cortes.

    #### 📦 Controle de Estoque Inteligente
    *   Cadastro de produtos com **Preço de Custo** e **Preço de Venda**.
    *   Venda direta no PDV com baixa automática no estoque.
    *   Relatório de lucro líquido por produto.
    """)

with f2:
    st.markdown("""
    #### 📊 Financeiro Transparente
    *   Visão clara do Faturamento Bruto vs Comissões.
    *   Controle de Sangrias (Retiradas).
    *   Logs detalhados de todas as ações (quem vendeu, o que vendeu).

    #### 💈 Área da Equipe
    *   Cadastro de Barbeiros.
    *   Painel individual para cada profissional acompanhar sua comissão.
    *   Segurança: cada usuário gerencia apenas sua barbearia.
    """)

st.write("\n" * 4)

# 4. PREÇOS (Estratégia de Âncora)
st.markdown("<h2 style='text-align: center; color: #D4AF37;'>Invista no seu Negócio</h2>", unsafe_allow_html=True)
st.write("\n")

p1, p2, p3 = st.columns([1, 1.5, 1])

with p1:
    st.markdown("""
    <div class="price-card">
        <h3>INICIANTE</h3>
        <h1>R$ 49<span style="font-size:0.5em">/mês</span></h1>
        <p>1 Usuário</p>
        <p>Agenda Digital</p>
        <p>Suporte via Chat</p>
    </div>
    """, unsafe_allow_html=True)

with p2:
    # Plano em Destaque
    st.markdown("""
    <div class="price-card price-highlight">
        <h3 style="color:#D4AF37">PROFISSIONAL</h3>
        <h1 style="color:white">R$ 99<span style="font-size:0.5em">/mês</span></h1>
        <p><strong>Usuários Ilimitados</strong></p>
        <p><strong>Controle de Estoque</strong></p>
        <p><strong>Relatórios de Lucro</strong></p>
        <p><strong>Gestão de Equipe</strong></p>
        <p>Suporte Prioritário</p>
    </div>
    """, unsafe_allow_html=True)
    st.link_button("ESCOLHER ESTE", link_whatsapp)

with p3:
    st.markdown("""
    <div class="price-card">
        <h3>ENTERPRISE</h3>
        <h1>R$ 199<span style="font-size:0.5em">/mês</span></h1>
        <p>Tudo do Profissional</p>
        <p>Servidor Exclusivo</p>
        <p>Integração WhatsApp</p>
        <p>Consultoria Mensal</p>
    </div>
    """, unsafe_allow_html=True)

st.write("\n" * 4)

# 5. FOOTER / CONTATO
st.markdown("""
<div class="footer">
    <h3>Pronto para transformar sua barbearia?</h3>
    <p>Não perca mais tempo com planilhas que não funcionam.</p>
    <a href="{}" target="_blank">
        <button style="background-color:#D4AF37; color:black; padding:10px 20px; border-radius:10px; border:none; font-weight:bold; cursor:pointer;">
            FALAR COM ESPECIALISTA
        </button>
    </a>
    <br><br>
    <p>© 2024 Barber Pro Luxury. Todos os direitos reservados.</p>
    <p>Desenvolvido com 💻 e muito 💈.</p>
</div>
""".format(link_whatsapp), unsafe_allow_html=True)
