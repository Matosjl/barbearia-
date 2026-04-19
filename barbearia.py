import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime
import time
from datetime import datetime, timedelta, timezone

def obter_data_brasil():
    # Cria o fuso horário de Brasília (UTC-3)
    fuso_br = timezone(timedelta(hours=-3))
    return datetime.now(fuso_br)

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")

# --- VERSÃO DO SISTEMA ---
__version__ = "0.0.0.6" # Atualizei a versão para controle

# --- CSS PERSONALIZADO (DESIGN DE ALTO PADRÃO) ---
st.markdown("""
    <style>
    /* Configurações Gerais */
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    [data-testid="stSidebar"] { background-color: #161B22 !important; border-right: 1px solid #30363D; }
    
    /* Títulos */
    h1 { color: #D4AF37 !important; font-family: 'Inter', sans-serif; font-weight: 800; text-transform: uppercase; text-align: center; }
    h2, h3 { color: #FFFFFF !important; }

    /* Inputs e Campos de Seleção */
    .stTextInput input, .stSelectbox div[data-baseweb="select"], .stNumberInput input {
        background-color: #1C2128 !important; border: 1px solid #30363D !important; color: #FFFFFF !important; border-radius: 8px !important;
    }
    
    /* Labels (Nomes dos campos) */
    label p { color: #D4AF37 !important; font-weight: 600 !important; }

    /* Botões */
    div.stButton > button { 
        background-color: #D4AF37; 
        color: #000000; 
        font-weight: bold; 
        width: 100%; 
        border-radius: 8px;
        border: none;
        transition: 0.3s;
    }
    div.stButton > button:hover {
        background-color: #FFFFFF;
        color: #000000;
    }

    /* --- CORREÇÃO DE BRILHO (TEXTOS APAGADOS) --- */
    /* Garante que textos informativos e parágrafos fiquem brancos e não cinza escuro */
    .stMarkdown p, .stCaption, [data-testid="stWidgetLabel"] p, .stText {
        color: #FFFFFF !important;
        opacity: 1 !important;
    }

    /* Melhora a visibilidade dentro da Sidebar e dos Expanders */
    [data-testid="stSidebar"] .stMarkdown p, [data-testid="stSidebar"] .stText {
        color: #FFFFFF !important;
        font-size: 1.05rem;
    }

    /* Estilo específico para o Expander de horários para não ficar "escondido" */
    .streamlit-expanderHeader {
        background-color: #1C2128 !important;
        color: #D4AF37 !important;
        border-radius: 5px;
    }
    
    /* Ajuste de métricas para não ficarem opacas */
    [data-testid="stMetricValue"] {
        color: #D4AF37 !important;
    }
    [data-testid="stMetricLabel"] p {
        color: #8B949E !important;
    }
    </style>
    """, unsafe_allow_html=True)


# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco(); cursor = conn.cursor()
    # Mantendo suas tabelas de serviços, vendas e logs
    cursor.execute('CREATE TABLE IF NOT EXISTS servicos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE, preco REAL)')
    cursor.execute('CREATE TABLE IF NOT EXISTS historico_vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, horario TEXT, cliente TEXT, servico TEXT, barbeiro TEXT, valor_total REAL, metodo_pagamento TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)')
    # ACRESCENTANDO a tabela de agendamentos (Sem excluir nada!)
    cursor.execute('CREATE TABLE IF NOT EXISTS agendamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, horario TEXT, cliente TEXT, servico TEXT)')
    conn.commit(); conn.close()

def carregar_dados(query):
    conn = conectar_banco(); df = pd.read_sql_query(query, conn); conn.close()
    return df


def registrar_log(acao, detalhes):
    conn = conectar_banco(); cursor = conn.cursor()
    horario = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    cursor.execute("INSERT INTO logs (horario, usuario, acao, detalhes) VALUES (?,?,?,?)", (horario, "admin", acao, detalhes))
    conn.commit(); conn.close()

# --- MODAIS (DIALOGS) ---
@st.dialog("📅 Novo Agendamento")
def modal_agendamento():
    # Pega a data e hora atual de Brasília
    agora_brasil = obter_data_brasil()
    
    st.markdown("### ✂️ Detalhes do Horário")
    c1, c2 = st.columns(2)
    
    # Agora o min_value será o dia 18 (hoje no Brasil)
    data_sel = c1.date_input("📅 Data", min_value=agora_brasil.date())
    hora_sel = c2.time_input("⏰ Horário", value=agora_brasil.time())
    
    cli = st.text_input("👤 Nome do Cliente")
    # ... resto do código igual ...
    
    df_servs = carregar_dados("SELECT nome FROM servicos")
    serv_list = df_servs['nome'].tolist() if not df_servs.empty else ["Nenhum cadastrado"]
    serv_sel = st.selectbox("💇‍♂️ Serviço Desejado", serv_list)
    
    st.divider()
    
    if st.button("CONFIRMAR E SALVAR AGENDAMENTO"):
        if cli.strip() == "":
            st.error("Por favor, digite o nome do cliente.")
        else:
            with st.spinner("Reservando horário..."):
                conn = conectar_banco()
                cur = conn.cursor()
                cur.execute("INSERT INTO agendamentos (data, horario, cliente, servico) VALUES (?,?,?,?)",
                            (data_sel.strftime("%Y-%m-%d"), hora_sel.strftime("%H:%M"), cli, serv_sel))
                conn.commit()
                conn.close()
                
                # Registro automático no log para auditoria
                registrar_log("AGENDAMENTO", f"Cliente {cli} agendado para {data_sel} às {hora_sel}")
                
                st.success(f"✅ Sucesso! {cli} agendado para às {hora_sel.strftime('%H:%M')}.")
                time.sleep(1.5)
                st.rerun()

@st.dialog("Finalizar Atendimento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Total: R$ {dados['total']:.2f}")
    metodo = st.radio("Pagamento", ["PIX", "Cartão", "Dinheiro"])
    if st.button("CONFIRMAR RECEBIMENTO"):
        conn = conectar_banco(); cursor = conn.cursor()
        data_hj = datetime.now().strftime("%Y-%m-%d")
        hora_hj = datetime.now().strftime("%H:%M:%S")
        cursor.execute("INSERT INTO historico_vendas (data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento) VALUES (?,?,?,?,?,?,?)",
                       (data_hj, hora_hj, dados['cliente'], dados['servico'], dados['barbeiro'], dados['total'], metodo))
        conn.commit(); conn.close()
        registrar_log("VENDA", f"{dados['servico']} para {dados['cliente']}")
        st.success("Venda registrada!"); st.balloons(); time.sleep(1); st.rerun()

# --- LOGIN ---
def login():
    if 'autenticado' not in st.session_state: st.session_state.autenticado = False
    if not st.session_state.autenticado:
        st.markdown("""<style>.stApp { background-image: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url("https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=1000"); background-size: cover; }</style>""", unsafe_allow_html=True)
        col1, col2, col3 = st.columns([1, 1.2, 1])
        with col2:
            st.markdown("<h1 style='color:white !important;'>👑 LOGIN</h1>", unsafe_allow_html=True)
            u = st.text_input("Usuário"); p = st.text_input("Senha", type="password")
            if st.button("ENTRAR"):
                if u == "admin" and p == "1234": st.session_state.autenticado = True; st.rerun()
                else: st.error("Incorreto")
        return False
    return True

# --- APP PRINCIPAL ---
if login():
    criar_tabelas()

    # --- SIDEBAR (NOTIFICAÇÕES + SUPORTE) ---
    with st.sidebar:
        st.markdown("### 👤 Administrador")
        # Alerta de Agendamento (Como na sua foto!)
        hj = datetime.now().strftime("%Y-%m-%d")
        df_ag = carregar_dados(f"SELECT * FROM agendamentos WHERE data = '{hj}'")
        if not df_ag.empty:
            st.error(f"🔔 Você tem {len(df_ag)} hora(s) hoje!")
            with st.expander("Ver horários"):
                for _, r in df_ag.iterrows(): st.write(f"⏰ {r['horario']} - {r['cliente']}")
        
        st.divider()
        if st.button("📅 Agendar Novo Horário", use_container_width=True): modal_agendamento()
        st.link_button("🟢 Desenvolvedor do WhatsApp", "https://wa.me/555181521264", use_container_width=True)
        if st.button("🚪 Sair", use_container_width=True): st.session_state.autenticado = False; st.rerun()

    st.markdown("<h1> 💈 BARBEARIA PROFISSIONAL DE LUXO </h1>", unsafe_allow_html=True)
    
    # Adicionando todas as abas que você tinha nas fotos
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["✂️ ATENDIMENTO", "📊 PAINEL DE CONTROLE", "📈 ANUAL", "⚙️ AJUSTES", "🕵️ AUDITORIA"])

    with tab1: # ATENDIMENTO
        st.subheader("Novo Check-in")
        df_s = carregar_dados("SELECT * FROM servicos")
        c1, c2 = st.columns(2)
        with c1:
            nome_c = st.text_input("Nome do Cliente")
            barb = st.selectbox("Barbeiro", ["Carlos", "Ricardo", "Felipe"])
        with c2:
            if not df_s.empty:
                serv_n = st.selectbox("Escolha o Serviço", df_s['nome'].tolist())
                v_base = df_s[df_s['nome'] == serv_n]['preco'].iloc[0]
                adicional = st.number_input("Adicional R$", min_value=0.0)
                total_v = v_base + adicional
                st.info(f"Total: R$ {total_v:.2f}")
                if st.button("FECHAR CONTA"):
                    st.session_state.dados_venda = {"cliente": nome_c, "servico": serv_n, "barbeiro": barb, "total": total_v}
                    checkout()
            else: st.warning("Cadastre serviços primeiro.")

        with tab2: # PAINEL DE CONTROLE (Dashboard da sua foto)
            st.subheader("📊 Performance Financeira")
            df_v = carregar_dados("SELECT * FROM historico_vendas")
            if not df_v.empty:
                m1, m2, m3 = st.columns(3)
                m1.metric("FATURAMENTO", f"R$ {df_v['valor_total'].sum():.2f}")
                m2.metric("SERVIÇOS", len(df_v))
                m3.metric("TICKET MÉDIO", f"R$ {df_v['valor_total'].mean():.2f}")
                
                st.write("### 💰 Fechamento por Método")
                df_met = df_v.pivot_table(index='barbeiro', columns='metodo_pagamento', values='valor_total', aggfunc='sum', fill_value=0)
                st.dataframe(df_met, use_container_width=True)
                st.bar_chart(df_v.groupby('barbeiro')['valor_total'].sum())
            else: st.info("Sem vendas.")

    with tab3: # ANUAL
        st.subheader("📈 Posição Financeira Anual")
        df_an = carregar_dados("SELECT * FROM historico_vendas")
        if not df_an.empty:
            df_an['data'] = pd.to_datetime(df_an['data'])
            df_an['mes'] = df_an['data'].dt.month
            evolucao = df_an.groupby('mes')['valor_total'].sum().reset_index()
            st.plotly_chart(px.line(evolucao, x='mes', y='valor_total', markers=True, template="plotly_dark", color_discrete_sequence=['#D4AF37']))
        else: st.info("Sem dados anuais.")

    with tab4: # AJUSTES
        st.subheader("Gestão de Serviços")
        ca, cb = st.columns([1, 2])
        with ca:
            ns = st.text_input("Serviço")
            np = st.number_input("Preço R$", min_value=0.0)
            if st.button("SALVAR"):
                conn = conectar_banco(); cur = conn.cursor()
                cur.execute("INSERT OR REPLACE INTO servicos (nome, preco) VALUES (?,?)", (ns, np))
                conn.commit(); conn.close(); st.rerun()
        with cb:
            st.dataframe(carregar_dados("SELECT nome, preco FROM servicos"), use_container_width=True)

    with tab5: # AUDITORIA (A foto que você mandou!)
        st.subheader("🕵️ Histórico de Logs")
        st.dataframe(carregar_dados("SELECT * FROM logs ORDER BY id DESC"), use_container_width=True)

    st.caption(f"💎 Barber Pro Luxury v{__version__} | Excellence in Management")