import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime
import time

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")

# --- VERSÃO DO SISTEMA ---
__version__ = "0.0.0.3"

# --- CSS PERSONALIZADO (DESIGN DE ALTO PADRÃO) ---
st.markdown("""
    <style>
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    [data-testid="stSidebar"] { background-color: #161B22 !important; border-right: 1px solid #30363D; }
    
    h1 { color: #D4AF37 !important; font-family: 'Inter', sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; text-align: center; }
    h3 { color: #E0E0E0 !important; font-size: 1.2rem; margin-top: 20px; }

    .stTextInput input, .stSelectbox div[data-baseweb="select"], .stNumberInput input {
        background-color: #1C2128 !important;
        border: 1px solid #30363D !important;
        color: #FFFFFF !important;
        border-radius: 8px !important;
        height: 45px !important;
    }
    
    label p { color: #D4AF37 !important; font-weight: 600 !important; font-size: 0.9rem !important; margin-bottom: 8px !important; }

    .stTabs [data-baseweb="tab-list"] { gap: 10px; }
    .stTabs [data-baseweb="tab"] {
        background-color: #161B22;
        border: 1px solid #30363D;
        padding: 10px 30px;
        border-radius: 10px 10px 0 0;
        color: #8B949E !important;
    }
    .stTabs [aria-selected="true"] { background-color: #D4AF37 !important; color: #000000 !important; border: none !important; }

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
    div.stButton > button:hover { background-color: #F1C40F; box-shadow: 0px 4px 15px rgba(212, 175, 55, 0.3); }
    </style>
    """, unsafe_allow_html=True)

# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco(); cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS servicos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE, preco REAL)')
    cursor.execute('CREATE TABLE IF NOT EXISTS historico_vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, cliente TEXT, servico TEXT, barbeiro TEXT, valor_total REAL, metodo_pagamento TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)')
    conn.commit(); conn.close()

def registrar_log(acao, detalhes):
    conn = conectar_banco(); cursor = conn.cursor()
    horario = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    cursor.execute("INSERT INTO logs (horario, usuario, acao, detalhes) VALUES (?,?,?,?)", (horario, "admin", acao, detalhes))
    conn.commit(); conn.close()

def carregar_dados(query):
    conn = conectar_banco(); df = pd.read_sql_query(query, conn); conn.close()
    return df

# --- SISTEMA DE LOGIN SEGURO ---
# --- SISTEMA DE LOGIN COM BACKGROUND ---
def login():
    if 'autenticado' not in st.session_state:
        st.session_state.autenticado = False
    
    if not st.session_state.autenticado:
        # CSS específico para colocar a imagem de fundo apenas na tela de login
        st.markdown(f"""
            <style>
            .stApp {{
                background-image: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), 
                url("https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=1000");
                background-size: cover;
                background-position: center;
            }}
            /* Deixa a caixa de login semi-transparente para o efeito de vidro (Glassmorphism) */
            div[data-testid="stVerticalBlock"] > div:has(input) {{
                background: rgba(22, 27, 34, 0.8);
                padding: 30px;
                border-radius: 15px;
                border: 1px solid rgba(212, 175, 55, 0.3);
                backdrop-filter: blur(10px);
            }}
            </style>
            """, unsafe_allow_html=True)

        st.markdown("<h1 style='text-align: center; margin-top: 50px;'>👑 BARBER PRO ACCESS</h1>", unsafe_allow_html=True)
        
        # Centralizando o formulário sobre a foto
        col1, col2, col3 = st.columns([1, 1.2, 1])
        with col2:
            st.write("") # Espaçador
            u = st.text_input("Usuário")
            p = st.text_input("Senha", type="password")
            if st.button("ENTRAR NO CLUB"):
                if u == "admin" and p == "1234":
                    st.session_state.autenticado = True
                    st.rerun()
                else:
                    st.error("Acesso negado.")
        return False
    return True

@st.dialog("Finalizar Atendimento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Total: R$ {dados['total']:.2f}")
    metodo = st.radio("Pagamento", ["PIX", "Cartão", "Dinheiro"])
    if metodo == "PIX":
        st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=BarberPix{dados['total']}")
    if st.button("CONFIRMAR RECEBIMENTO"):
        conn = conectar_banco(); cursor = conn.cursor()
        cursor.execute("INSERT INTO historico_vendas (horario, cliente, servico, barbeiro, valor_total, metodo_pagamento) VALUES (?,?,?,?,?,?)",
                       (datetime.now().strftime("%H:%M:%S"), dados['cliente'], dados['servico'], dados['barbeiro'], dados['total'], metodo))
        conn.commit(); conn.close()
        registrar_log("VENDA", f"{dados['servico']} para {dados['cliente']}")
        st.success("Venda registrada!"); st.balloons(); time.sleep(1); st.rerun()

# --- APP PRINCIPAL ---
if login():
    criar_tabelas()
    st.markdown("<h1> 💈 BARBER PRO LUXURY </h1>", unsafe_allow_html=True)
    
    if st.sidebar.button("🚪 Sair"):
        st.session_state.autenticado = False
        st.rerun()

    aba1, aba2, aba3 = st.tabs(["✂️ ATENDIMENTO", "📊 DASHBOARD", "⚙️ AJUSTES"])

    with aba1:
        st.subheader("Novo Check-in")
        df_serv = carregar_dados("SELECT * FROM servicos")
        c1, c2 = st.columns(2)
        with c1:
            nome = st.text_input("Cliente")
            barber = st.selectbox("Especialista", ["Carlos", "Ricardo", "Felipe"])
        with c2:
            if not df_serv.empty:
                serv = st.selectbox("Serviço", df_serv['nome'].tolist())
                preco = df_serv[df_serv['nome'] == serv]['preco'].iloc[0]
                extra = st.number_input("Adicionais (R$)", min_value=0.0)
                total = preco + extra
                st.markdown(f"""<div style="border: 1px solid #D4AF37; padding:10px; border-radius:10px; text-align:center;">
                            <p style='margin:0; color:#8B949E;'>TOTAL</p><h2 style='margin:0; color:#D4AF37;'>R$ {total:.2f}</h2></div>""", unsafe_allow_html=True)
                if st.button("CONCLUIR SERVIÇO"):
                    st.session_state.dados_venda = {"cliente": nome, "servico": serv, "barbeiro": barber, "total": total}
                    checkout()
            else: st.warning("Cadastre os serviços primeiro.")

    with aba2:
        st.subheader("📊 Performance Financeira")
        df_hist = carregar_dados("SELECT * FROM historico_vendas")
        if not df_hist.empty:
            m1, m2, m3 = st.columns(3)
            m1.metric("FATURAMENTO", f"R$ {df_hist['valor_total'].sum():.2f}")
            m2.metric("SERVIÇOS", len(df_hist))
            m3.metric("TICKET MÉDIO", f"R$ {df_hist['valor_total'].mean():.2f}")

            st.write("### 💰 Fechamento por Método")
            df_fechamento = df_hist.pivot_table(index='barbeiro', columns='metodo_pagamento', values='valor_total', aggfunc='sum', fill_value=0)
            df_fechamento['TOTAL'] = df_fechamento.sum(axis=1)
            st.dataframe(df_fechamento.style.format("R$ {:.2f}"), use_container_width=True)

            g1, g2 = st.columns(2)
            with g1:
                fig1 = px.bar(df_hist.groupby('barbeiro')['valor_total'].sum().reset_index(), x='barbeiro', y='valor_total', template="plotly_dark", color_discrete_sequence=['#D4AF37'])
                st.plotly_chart(fig1, use_container_width=True)
            with g2:
                fig2 = px.pie(df_hist, values='valor_total', names='metodo_pagamento', template="plotly_dark", hole=0.4, color_discrete_sequence=['#D4AF37', '#B8860B', '#8B949E'])
                st.plotly_chart(fig2, use_container_width=True)
        else: st.info("Sem dados para exibir.")

    with aba3:
        st.subheader("Gestão de Itens")
        c_cad1, c_cad2 = st.columns([1, 2])
        with c_cad1:
            ns = st.text_input("Nome Serviço")
            np = st.number_input("Preço", min_value=0.0)
            if st.button("SALVAR"):
                conn = conectar_banco(); cur = conn.cursor()
                cur.execute("INSERT OR REPLACE INTO servicos (nome, preco) VALUES (?,?)", (ns, np))
                conn.commit(); conn.close(); st.rerun()
        with c_cad2:
            st.dataframe(carregar_dados("SELECT nome, preco FROM servicos"), use_container_width=True)
        
        st.divider()
        st.write("### 🕵️ Auditoria")
        st.dataframe(carregar_dados("SELECT * FROM logs ORDER BY id DESC LIMIT 5"), use_container_width=True)

    st.caption(f"💎 Barber Pro Luxury v{__version__} | Excellence in Management")