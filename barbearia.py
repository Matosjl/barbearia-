import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime
import time

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")

# --- VERSÃO DO SISTEMA ---
__version__ = "0.0.0.2"

# --- CSS PERSONALIZADO (UX & LUXURY 2.0) ---
st.markdown("""
    <style>
    /* 1. Limpeza do fundo e Sidebar */
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    [data-testid="stSidebar"] { background-color: #161B22 !important; border-right: 1px solid #30363D; }
    
    /* 2. Títulos com elegância e espaçamento */
    h1 { color: #D4AF37 !important; font-family: 'Inter', sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }
    h3 { color: #E0E0E0 !important; font-size: 1.2rem; margin-top: 20px; }

    /* 3. Correção Total dos Inputs (Onde estava o erro) */
    .stTextInput input, .stSelectbox div[data-baseweb="select"], .stNumberInput input {
        background-color: #1C2128 !important;
        border: 1px solid #30363D !important;
        color: #FFFFFF !important;
        border-radius: 8px !important;
        height: 45px !important;
    }
    
    /* 4. Estilização das Labels (Para não encavalar) */
    label p {
        color: #D4AF37 !important;
        font-weight: 600 !important;
        font-size: 0.9rem !important;
        margin-bottom: 8px !important;
    }

    /* 5. Abas (Tabs) Profissionais */
    .stTabs [data-baseweb="tab-list"] { gap: 10px; background-color: transparent; }
    .stTabs [data-baseweb="tab"] {
        background-color: #161B22;
        border: 1px solid #30363D;
        padding: 10px 30px;
        border-radius: 10px 10px 0 0;
        color: #8B949E !important;
    }
    .stTabs [aria-selected="true"] {
        background-color: #D4AF37 !important;
        color: #000000 !important;
        border: none !important;
    }

    /* 6. Botão de Luxo (Sólido e moderno) */
    div.stButton > button {
        background-color: #D4AF37;
        color: #000000;
        border: none;
        font-weight: bold;
        padding: 15px 30px;
        width: 100%;
        border-radius: 8px;
        transition: 0.3s;
    }
    div.stButton > button:hover {
        background-color: #F1C40F;
        box-shadow: 0px 4px 15px rgba(212, 175, 55, 0.3);
    }
    </style>
    """, unsafe_allow_html=True)

# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco()
    cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS servicos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE, preco REAL)')
    cursor.execute('CREATE TABLE IF NOT EXISTS historico_vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, cliente TEXT, servico TEXT, barbeiro TEXT, valor_total REAL, metodo_pagamento TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)')
    conn.commit()
    conn.close()

def registrar_log(acao, detalhes):
    conn = conectar_banco()
    cursor = conn.cursor()
    horario = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    cursor.execute("INSERT INTO logs (horario, usuario, acao, detalhes) VALUES (?,?,?,?)", (horario, "admin", acao, detalhes))
    conn.commit()
    conn.close()

def carregar_dados(query):
    conn = conectar_banco()
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df

# --- SISTEMA DE LOGIN ---
def login():
    if 'autenticado' not in st.session_state:
        st.session_state.autenticado = False
    if not st.session_state.autenticado:
        st.markdown("<h1 style='text-align: center;'>👑 BARBER PRO ACCESS</h1>", unsafe_allow_html=True)
        col1, col2, col3 = st.columns([1, 1.5, 1])
        with col2:
            u = st.text_input("Usuário")
            p = st.text_input("Senha", type="password")
            if st.button("ENTRAR NO CLUB"):
                if u == "admin" and p == "1234":
                    st.session_state.autenticado = True
                    st.rerun()
                else: st.error("Credenciais Inválidas")
        return False
    return True

@st.dialog("Finalizar Atendimento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Total a Receber: R$ {dados['total']:.2f}")
    metodo = st.radio("Método", ["PIX", "Cartão", "Dinheiro"])
    if metodo == "PIX":
        st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=BarberPix{dados['total']}")
    if st.button("CONFIRMAR PAGAMENTO"):
        conn = conectar_banco(); cursor = conn.cursor()
        cursor.execute("INSERT INTO historico_vendas (horario, cliente, servico, barbeiro, valor_total, metodo_pagamento) VALUES (?,?,?,?,?,?)",
                       (datetime.now().strftime("%H:%M:%S"), dados['cliente'], dados['servico'], dados['barbeiro'], dados['total'], metodo))
        conn.commit(); conn.close()
        registrar_log("VENDA", f"{dados['servico']} - {dados['cliente']}")
        st.success("Venda registrada!")
        st.balloons(); time.sleep(1); st.rerun()

# --- APP PRINCIPAL ---
if login():
    criar_tabelas()
    
    # Header estilizado
    st.markdown("<h1 style='text-align: center; margin-bottom: 0;'> 💈 BARBER PRO LUXURY </h1>", unsafe_allow_html=True)
    st.markdown("<p style='text-align: center; color: #8B949E; margin-top: 0;'>Management Excellence System</p>", unsafe_allow_html=True)
    st.divider()

    if st.sidebar.button("🚪 Sair"):
        st.session_state.autenticado = False
        st.rerun()

    aba1, aba2, aba3 = st.tabs(["✂️ ATENDIMENTO", "📊 DASHBOARD", "⚙️ AJUSTES"])

    with aba1:
        st.subheader("Novo Check-in")
        df_serv = carregar_dados("SELECT * FROM servicos")
        c1, c2 = st.columns(2)
        with c1:
            nome = st.text_input("Nome do Cliente")
            barber = st.selectbox("Profissional", ["Carlos", "Ricardo", "Felipe"])
        with c2:
            if not df_serv.empty:
                serv = st.selectbox("Serviço", df_serv['nome'].tolist())
                preco = df_serv[df_serv['nome'] == serv]['preco'].iloc[0]
                extra = st.number_input("Adicionais (R$)", min_value=0.0)
                total = preco + extra
                st.markdown(f"## Total: R$ {total:.2f}")
                if st.button("CONCLUIR SERVIÇO"):
                    st.session_state.dados_venda = {"cliente": nome, "servico": serv, "barbeiro": barber, "total": total}
                    checkout()
            else: st.warning("Cadastre serviços primeiro.")

    with aba2:
        st.subheader("📊 Performance e Fechamento de Caixa")
        df_hist = carregar_dados("SELECT * FROM historico_vendas")
        
        if not df_hist.empty:
            # --- CARDS DE RESUMO ---
            c1, c2, c3 = st.columns(3)
            c1.metric("FATURAMENTO TOTAL", f"R$ {df_hist['valor_total'].sum():.2f}")
            c2.metric("TOTAL ATENDIMENTOS", len(df_hist))
            c3.metric("TICKET MÉDIO", f"R$ {df_hist['valor_total'].mean():.2f}")

            st.divider()

            # --- TABELA DE FECHAMENTO (DINHEIRO, CARTÃO, PIX) ---
            st.write("### 💰 Fechamento por Barbeiro e Forma de Pagamento")
            
            try:
                # Criando a tabela cruzada (Pivot Table)
                # Linhas: Barbeiros | Colunas: Métodos | Valores: Soma dos Preços
                df_fechamento = df_hist.pivot_table(
                    index='barbeiro', 
                    columns='metodo_pagamento', 
                    values='valor_total', 
                    aggfunc='sum', 
                    fill_value=0
                )
                
                # Adiciona a coluna de Total por Barbeiro
                df_fechamento['TOTAL GERAL'] = df_fechamento.sum(axis=1)
                
                # Exibe a tabela com formatação de moeda
                st.dataframe(
                    df_fechamento.style.format("R$ {:.2f}"), 
                    use_container_width=True
                )
                st.caption("Valores brutos acumulados por profissional e método.")
            except Exception as e:
                st.error(f"Erro ao processar fechamento: {e}")

            st.divider()

            # --- TABELA DE PRODUTIVIDADE (QUANTIDADE) ---
            st.write("### ✂️ Volume de Serviços")
            prod = df_hist.groupby(['barbeiro', 'servico']).size().unstack(fill_value=0)
            st.dataframe(prod, use_container_width=True)

            # --- GRÁFICOS ---
            col_g1, col_g2 = st.columns(2)
            with col_g1:
                fig_bar = px.bar(df_hist.groupby('barbeiro')['valor_total'].sum().reset_index(), 
                                 x='barbeiro', y='valor_total', template="plotly_dark",
                                 color_discrete_sequence=['#d4af37'], title="Faturamento por Profissional")
                st.plotly_chart(fig_bar, use_container_width=True)
            with col_g2:
                # Corrigido para 'Solar' que é a sequência válida de tons amarelos/ouro
                # Substitua a linha do erro por esta:
                fig_pie = px.pie(
                    df_hist, 
                    values='valor_total', 
                    names='metodo_pagamento', 
                    template="plotly_dark", 
                    hole=0.4, 
                    color_discrete_sequence=['#D4AF37', '#B8860B', '#8B949E'], # Dourado, Bronze e Cinza
                    title="Distribuição por Meio de Pagamento"
                )
        else:
            st.info("Aguardando registros de vendas para gerar relatórios.")

    with aba3:
        st.subheader("Configurações do Sistema")
        col_cad1, col_cad2 = st.columns([1, 2])
        with col_cad1:
            st.markdown("### ➕ Novo Serviço")
            ns = st.text_input("Nome do Item")
            np = st.number_input("Valor", min_value=0.0)
            if st.button("CADASTRAR"):
                conn = conectar_banco(); cur = conn.cursor()
                cur.execute("INSERT OR REPLACE INTO servicos (nome, preco) VALUES (?,?)", (ns, np))
                conn.commit(); conn.close()
                st.success("Atualizado!")
                st.rerun()
        with col_cad2:
            st.markdown("### 📋 Tabela de Preços")
            st.dataframe(carregar_dados("SELECT nome, preco FROM servicos"), use_container_width=True)
        
        st.divider()
        st.write("### 🕵️ Auditoria de Logs")
        st.dataframe(carregar_dados("SELECT * FROM logs ORDER BY id DESC LIMIT 10"), use_container_width=True)

    st.caption(f"Barber Pro Luxury v{__version__} | Fins Educativos")