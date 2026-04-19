import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta, timezone
import time

# --- FUNÇÃO DE HORÁRIO BRASÍLIA ---
def obter_data_brasil():
    fuso_br = timezone(timedelta(hours=-3))
    return datetime.now(fuso_br)

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")
__version__ = "1.1.0"

# --- CSS PERSONALIZADO ---
st.markdown("""
    <style>
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    [data-testid="stSidebar"] { background-color: #161B22 !important; border-right: 1px solid #30363D; }
    h1 { color: #D4AF37 !important; font-family: 'Inter', sans-serif; font-weight: 800; text-transform: uppercase; text-align: center; }
    .stTextInput input, .stSelectbox div[data-baseweb="select"], .stNumberInput input {
        background-color: #1C2128 !important; border: 1px solid #30363D !important; color: #FFFFFF !important; border-radius: 8px !important;
    }
    label p { color: #D4AF37 !important; font-weight: 600 !important; }
    div.stButton > button { background-color: #D4AF37; color: #000000; font-weight: bold; width: 100%; border-radius: 8px; border: none; transition: 0.3s; }
    div.stButton > button:hover { background-color: #FFFFFF; color: #000000; }
    .stMarkdown p, .stCaption, [data-testid="stWidgetLabel"] p, .stText { color: #FFFFFF !important; }
    [data-testid="stMetricValue"] { color: #D4AF37 !important; }
    </style>
    """, unsafe_allow_html=True)

# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco(); cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, senha TEXT, nome_barbearia TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS servicos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, nome TEXT, preco REAL)')
    # NOVA TABELA DE BARBEIROS
    cursor.execute('CREATE TABLE IF NOT EXISTS equipe (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, nome TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS historico_vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, data TEXT, horario TEXT, cliente TEXT, servico TEXT, barbeiro TEXT, valor_total REAL, metodo_pagamento TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS agendamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, data TEXT, horario TEXT, cliente TEXT, servico TEXT)')
    conn.commit(); conn.close()

def carregar_dados(query, params=()):
    conn = conectar_banco(); df = pd.read_sql_query(query, conn, params=params); conn.close()
    return df

def registrar_log(acao, detalhes):
    conn = conectar_banco(); cursor = conn.cursor()
    horario = obter_data_brasil().strftime("%d/%m/%Y %H:%M:%S")
    cursor.execute("INSERT INTO logs (usuario_id, horario, usuario, acao, detalhes) VALUES (?,?,?,?,?)", 
                   (st.session_state.user_id, horario, st.session_state.login, acao, detalhes))
    conn.commit(); conn.close()

# --- FUNÇÕES DE ACESSO ---
def validar_login(u, p):
    conn = conectar_banco(); cursor = conn.cursor()
    cursor.execute("SELECT id, nome_barbearia FROM usuarios WHERE login = ? AND senha = ?", (u, p))
    user = cursor.fetchone()
    conn.close()
    return user

def cadastrar_usuario(u, p, n):
    try:
        conn = conectar_banco(); cursor = conn.cursor()
        cursor.execute("INSERT INTO usuarios (login, senha, nome_barbearia) VALUES (?,?,?)", (u, p, n))
        conn.commit(); conn.close()
        return True
    except: return False

# --- MODAIS ---
@st.dialog("📅 Novo Agendamento")
def modal_agendamento():
    agora_brasil = obter_data_brasil()
    st.markdown("### ✂️ Detalhes do Horário")
    data_sel = st.date_input("📅 Data", min_value=agora_brasil.date())
    hora_sel = st.time_input("⏰ Horário", value=agora_brasil.time())
    cli = st.text_input("👤 Nome do Cliente")
    df_servs = carregar_dados("SELECT nome FROM servicos WHERE usuario_id = ?", (st.session_state.user_id,))
    serv_list = df_servs['nome'].tolist() if not df_servs.empty else ["Nenhum"]
    serv_sel = st.selectbox("💇‍♂️ Serviço", serv_list)
    if st.button("CONFIRMAR"):
        conn = conectar_banco(); cur = conn.cursor()
        cur.execute("INSERT INTO agendamentos (usuario_id, data, horario, cliente, servico) VALUES (?,?,?,?,?)",
                    (st.session_state.user_id, data_sel.strftime("%Y-%m-%d"), hora_sel.strftime("%H:%M"), cli, serv_sel))
        conn.commit(); conn.close()
        st.success("✅ Agendado!"); time.sleep(1); st.rerun()

@st.dialog("Finalizar Atendimento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Total: R$ {dados['total']:.2f}")
    metodo = st.radio("Pagamento", ["PIX", "Cartão", "Dinheiro"])
    if st.button("CONFIRMAR RECEBIMENTO"):
        conn = conectar_banco(); cursor = conn.cursor()
        agora = obter_data_brasil()
        cursor.execute("INSERT INTO historico_vendas (usuario_id, data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento) VALUES (?,?,?,?,?,?,?,?)",
                       (st.session_state.user_id, agora.strftime("%Y-%m-%d"), agora.strftime("%H:%M:%S"), dados['cliente'], dados['servico'], dados['barbeiro'], dados['total'], metodo))
        conn.commit(); conn.close()
        registrar_log("VENDA", f"{dados['servico']} - {dados['barbeiro']}")
        st.success("Venda registrada!"); st.balloons(); time.sleep(1); st.rerun()

# --- TELA DE ACESSO ---
def tela_acesso():
    if 'autenticado' not in st.session_state: st.session_state.autenticado = False
    if not st.session_state.autenticado:
        st.markdown("""<style>.stApp { background-image: linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), url("https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=1000"); background-size: cover; }</style>""", unsafe_allow_html=True)
        col1, col2, col3 = st.columns([1, 2, 1])
        with col2:
            st.markdown("<h1>👑 ACESSO BARBER PRO</h1>", unsafe_allow_html=True)
            tab_l, tab_c = st.tabs(["🔐 LOGIN", "📝 CRIAR CONTA"])
            with tab_l:
                u = st.text_input("Usuário", key="l_u")
                p = st.text_input("Senha", type="password", key="l_p")
                if st.button("ENTRAR NO SISTEMA"):
                    user = validar_login(u, p)
                    if user:
                        st.session_state.autenticado = True
                        st.session_state.user_id = user[0]
                        st.session_state.nome_loja = user[1]
                        st.session_state.login = u
                        st.rerun()
                    else: st.error("Incorreto")
            with tab_c:
                new_u = st.text_input("Usuário Desejado", key="c_u")
                new_n = st.text_input("Nome da Barbearia", key="c_n")
                new_p = st.text_input("Senha", type="password", key="c_p")
                if st.button("CADASTRAR"):
                    if cadastrar_usuario(new_u, new_p, new_n): st.success("Criado! Faça Login.")
                    else: st.error("Erro ou usuário já existe.")
        return False
    return True

# --- INÍCIO DO APP ---
criar_tabelas()
if tela_acesso():
    with st.sidebar:
        st.markdown(f"### 👤 {st.session_state.nome_loja}")
        if st.button("📅 Novo Agendamento", use_container_width=True): modal_agendamento()
        st.divider()
        # SEU CONTATO DE VOLTA
        st.link_button("🟢 Suporte WhatsApp", "https://wa.me/555181521264", use_container_width=True)
        if st.button("🚪 Sair", use_container_width=True): 
            st.session_state.autenticado = False
            st.rerun()

    st.markdown(f"<h1> 💈 {st.session_state.nome_loja} </h1>", unsafe_allow_html=True)
    t1, t2, t3, t4, t5 = st.tabs(["✂️ ATENDIMENTO", "📊 PAINEL", "📈 ANUAL", "⚙️ AJUSTES", "🕵️ LOGS"])

    with t1: # ATENDIMENTO
        df_s = carregar_dados("SELECT * FROM servicos WHERE usuario_id = ?", (st.session_state.user_id,))
        df_b = carregar_dados("SELECT * FROM equipe WHERE usuario_id = ?", (st.session_state.user_id,))
        
        c1, c2 = st.columns(2)
        with c1:
            nome_c = st.text_input("Nome do Cliente")
            lista_barbeiros = df_b['nome'].tolist() if not df_b.empty else ["Cadastre barbeiros"]
            barb = st.selectbox("Barbeiro", lista_barbeiros)
        with c2:
            if not df_s.empty:
                serv_n = st.selectbox("Serviço", df_s['nome'].tolist())
                v_base = df_s[df_s['nome'] == serv_n]['preco'].iloc[0]
                adicional = st.number_input("Adicional R$", min_value=0.0)
                if st.button("FECHAR CONTA"):
                    if not df_b.empty:
                        st.session_state.dados_venda = {"cliente": nome_c, "servico": serv_n, "barbeiro": barb, "total": v_base + adicional}
                        checkout()
                    else: st.error("Cadastre um barbeiro primeiro!")
            else: st.warning("Cadastre serviços primeiro.")

    with t2: # PAINEL (TABELAS QUE SUMIRAM)
        df_v = carregar_dados("SELECT * FROM historico_vendas WHERE usuario_id = ?", (st.session_state.user_id,))
        if not df_v.empty:
            m1, m2, m3 = st.columns(3)
            m1.metric("FATURAMENTO", f"R$ {df_v['valor_total'].sum():.2f}")
            m2.metric("SERVIÇOS", len(df_v))
            m3.metric("TICKET MÉDIO", f"R$ {df_v['valor_total'].mean():.2f}")
            
            st.markdown("### 💰 Fechamento por Barbeiro e Método")
            # ESSA É A TABELA QUE VOCÊ QUERIA DE VOLTA
            df_met = df_v.pivot_table(index='barbeiro', columns='metodo_pagamento', values='valor_total', aggfunc='sum', fill_value=0)
            df_met['TOTAL'] = df_met.sum(axis=1)
            st.dataframe(df_met.style.format("R$ {:.2f}"), use_container_width=True)
            
            st.plotly_chart(px.bar(df_v.groupby('barbeiro')['valor_total'].sum().reset_index(), x='barbeiro', y='valor_total', title="Faturamento por Barbeiro", template="plotly_dark", color_discrete_sequence=['#D4AF37']), use_container_width=True)
        else: st.info("Sem vendas ainda.")
    
    with t3: # ANUAL (CORRIGIDO)
        st.subheader("📈 Evolução Financeira Anual")
        # Busca todas as vendas do usuário logado
        df_an = carregar_dados("SELECT data, valor_total FROM historico_vendas WHERE usuario_id = ?", (st.session_state.user_id,))
        
        if not df_an.empty:
            # Converte a coluna data para o formato datetime do pandas
            df_an['data'] = pd.to_datetime(df_an['data'])
            # Cria uma coluna com o nome do mês ou número do mês
            df_an['Mes'] = df_an['data'].dt.strftime('%m (%b)') 
            
            # Agrupa por mês somando o valor total
            evolucao = df_an.groupby('Mes')['valor_total'].sum().reset_index()
            # Ordena para o gráfico não ficar bagunçado
            evolucao = evolucao.sort_values('Mes')

            # Cria o gráfico de linha
            fig_anual = px.line(
                evolucao, 
                x='Mes', 
                y='valor_total', 
                title="Faturamento Mensal",
                markers=True, 
                template="plotly_dark", 
                color_discrete_sequence=['#D4AF37']
            )
            
            # Ajusta o layout do gráfico
            fig_anual.update_layout(yaxis_title="Total R$", xaxis_title="Mês")
            st.plotly_chart(fig_anual, use_container_width=True)
            
            # Tabela comparativa logo abaixo
            st.markdown("### 📋 Resumo por Mês")
            st.table(evolucao.rename(columns={'valor_total': 'Total Fat.'}).set_index('Mes'))
        else:
            st.info("Ainda não há dados suficientes para gerar o gráfico anual. Registre algumas vendas primeiro!")

    with t4: # AJUSTES (GESTÃO DE BARBEIROS E SERVIÇOS)
        col_s, col_b = st.columns(2)
        
        with col_s:
            st.subheader("✂️ Serviços")
            ns = st.text_input("Novo Serviço")
            np = st.number_input("Preço R$", min_value=0.0)
            if st.button("ADICIONAR SERVIÇO"):
                if ns:
                    conn = conectar_banco(); cur = conn.cursor()
                    cur.execute("INSERT INTO servicos (usuario_id, nome, preco) VALUES (?,?,?)", (st.session_state.user_id, ns, np))
                    conn.commit(); conn.close(); st.rerun()
            
            df_lista_s = carregar_dados("SELECT id, nome, preco FROM servicos WHERE usuario_id = ?", (st.session_state.user_id,))
            st.dataframe(df_lista_s[["nome", "preco"]], use_container_width=True)
            del_s = st.selectbox("Excluir Serviço", [""] + df_lista_s['nome'].tolist())
            if st.button("EXCLUIR SERVIÇO"):
                conn = conectar_banco(); cur = conn.cursor(); cur.execute("DELETE FROM servicos WHERE nome=? AND usuario_id=?", (del_s, st.session_state.user_id)); conn.commit(); conn.close(); st.rerun()

        with col_b:
            st.subheader("🧔 Equipe de Barbeiros")
            nb = st.text_input("Nome do Barbeiro")
            if st.button("ADICIONAR BARBEIRO"):
                if nb:
                    conn = conectar_banco(); cur = conn.cursor()
                    cur.execute("INSERT INTO equipe (usuario_id, nome) VALUES (?,?)", (st.session_state.user_id, nb))
                    conn.commit(); conn.close(); st.rerun()
            
            df_equipe = carregar_dados("SELECT id, nome FROM equipe WHERE usuario_id = ?", (st.session_state.user_id,))
            st.dataframe(df_equipe[["nome"]], use_container_width=True)
            del_b = st.selectbox("Excluir Barbeiro", [""] + df_equipe['nome'].tolist())
            if st.button("EXCLUIR BARBEIRO"):
                conn = conectar_banco(); cur = conn.cursor(); cur.execute("DELETE FROM equipe WHERE nome=? AND usuario_id=?", (del_b, st.session_state.user_id)); conn.commit(); conn.close(); st.rerun()

    with t5:
        st.dataframe(carregar_dados("SELECT horario, acao, detalhes FROM logs WHERE usuario_id = ? ORDER BY id DESC", (st.session_state.user_id,)), use_container_width=True)

    st.caption(f"💎 Barber Pro Luxury v{__version__} | SaaS Ready")