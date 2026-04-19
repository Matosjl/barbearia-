import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime
import time

# --- VERSÃO DO SISTEMA ---
__version__ = "0.0.0.1"

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Barber Pro v1", layout="wide", page_icon="💈")

# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco()
    cursor = conn.cursor()
    
    # Tabela de Serviços
    cursor.execute('''CREATE TABLE IF NOT EXISTS servicos 
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE, preco REAL)''')
    
    # Tabela de Histórico corrigida com Metodo de Pagamento
    cursor.execute('''CREATE TABLE IF NOT EXISTS historico_vendas 
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, cliente TEXT, 
                      servico TEXT, barbeiro TEXT, valor_total REAL, metodo_pagamento TEXT)''')
    
    # Tabela de Logs
    cursor.execute('''CREATE TABLE IF NOT EXISTS logs 
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                      horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)''')
    
    conn.commit()
    conn.close()

def registrar_log(acao, detalhes):
    conn = conectar_banco()
    cursor = conn.cursor()
    horario = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    usuario = "admin" 
    cursor.execute("INSERT INTO logs (horario, usuario, acao, detalhes) VALUES (?,?,?,?)",
                   (horario, usuario, acao, detalhes))
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
        st.title("💈 Barber Pro - Acesso")
        col1, _ = st.columns(2)
        with col1:
            usuario = st.text_input("Usuário")
            senha = st.text_input("Senha", type="password")
            if st.button("Entrar"):
                if usuario == "admin" and senha == "1234":
                    st.session_state.autenticado = True
                    st.rerun()
                else:
                    st.error("Credenciais inválidas")
        return False
    return True

# --- GATEWAY DE PAGAMENTO (DIALOG) ---
@st.dialog("Finalizar Atendimento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Valor do Serviço: R$ {dados['total']:.2f}")
    metodo = st.radio("Forma de Pagamento", ["PIX", "Cartão", "Dinheiro"])

    if metodo == "PIX":
        st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=BarberPix{dados['total']}")
        st.caption("Escaneie para pagar")
    
    if st.button("Confirmar Recebimento"):
        with st.spinner("Processando..."):
            time.sleep(1)
        
        conn = conectar_banco()
        cursor = conn.cursor()
        # Salva a venda com o método de pagamento
        cursor.execute("""INSERT INTO historico_vendas 
                          (horario, cliente, servico, barbeiro, valor_total, metodo_pagamento) 
                          VALUES (?,?,?,?,?,?)""",
                       (datetime.now().strftime("%H:%M:%S"), dados['cliente'], dados['servico'], 
                        dados['barbeiro'], dados['total'], metodo))
        conn.commit()
        conn.close()
        
        # Registra o log
        registrar_log("VENDA", f"{dados['servico']} para {dados['cliente']} via {metodo}")
        
        st.success("Pagamento Confirmado!")
        st.balloons()
        time.sleep(1)
        st.rerun()

# --- EXECUÇÃO DO PROGRAMA ---
if login():
    criar_tabelas()

    if st.sidebar.button("🚪 Sair"):
        st.session_state.autenticado = False
        st.rerun()
    st.sidebar.markdown("---")
    st.sidebar.caption(f"🚀 Versão: {__version__}")

    st.title("💈 Barber Pro - Gestão de Barbearia")
    
    aba1, aba2, aba3 = st.tabs(["✂️ Atendimento", "📊 Financeiro", "⚙️ Configurações"])

    with aba1:
        st.subheader("Novo Atendimento")
        df_serv = carregar_dados("SELECT * FROM servicos")
        
        col_a, col_b = st.columns(2)
        with col_a:
            nome_c = st.text_input("Nome do Cliente")
            barbeiro = st.selectbox("Barbeiro Responsável", ["Carlos", "Ricardo", "Felipe"])
        
        with col_b:
            if not df_serv.empty:
                servico_sel = st.selectbox("Serviço Realizado", df_serv['nome'].tolist())
                preco_base = df_serv[df_serv['nome'] == servico_sel]['preco'].iloc[0]
                adicional = st.number_input("Adicional/Produtos (R$)", min_value=0.0, value=0.0)
                total = preco_base + adicional
                st.write(f"**Total a Pagar: R$ {total:.2f}**")
                
                if st.button("Finalizar e Pagar"):
                    st.session_state.dados_venda = {
                        "cliente": nome_c, "servico": servico_sel, "barbeiro": barbeiro, "total": total
                    }
                    checkout()
            else:
                st.warning("Cadastre serviços na aba Configurações.")

    with aba2:
        st.subheader("📊 Detalhamento Financeiro")
        df_hist = carregar_dados("SELECT * FROM historico_vendas")
        
        if not df_hist.empty:
            # MÉTRICAS GERAIS
            total_geral = df_hist['valor_total'].sum()
            c1, c2, c3 = st.columns(3)
            c1.metric("💰 Faturamento Total Geral", f"R$ {total_geral:.2f}")
            c2.metric("✂️ Total de Atendimentos", len(df_hist))
            c3.metric("📈 Ticket Médio", f"R$ {df_hist['valor_total'].mean():.2f}")

            st.write("---")
            st.write("### 🧮 Fechamento por Barbeiro (Por Método)")
            
            # Tabela Dinâmica: Barbeiro vs Método de Pagamento
            try:
                fechamento = df_hist.groupby(['barbeiro', 'metodo_pagamento'])['valor_total'].sum().unstack(fill_value=0)
                # Adiciona a soma total de cada barbeiro (linha)
                fechamento['TOTAL BARBEIRO'] = fechamento.sum(axis=1)
                st.dataframe(fechamento.style.format("R$ {:.2f}"), use_container_width=True)
            except Exception as e:
                st.error(f"Erro ao processar tabela: {e}")

            st.write("---")
            col_g1, col_g2 = st.columns(2)
            with col_g1:
                st.write("### Total por Barbeiro")
                fig_bar = px.bar(df_hist.groupby('barbeiro')['valor_total'].sum().reset_index(), 
                                 x='barbeiro', y='valor_total', color='barbeiro', text_auto='.2f')
                st.plotly_chart(fig_bar, use_container_width=True)
            with col_g2:
                st.write("### Uso dos Métodos de Pagamento")
                fig_pie = px.pie(df_hist, values='valor_total', names='metodo_pagamento', hole=.4)
                st.plotly_chart(fig_pie, use_container_width=True)
        else:
            st.info("Nenhum atendimento registrado.")

    with aba3:
        st.subheader("Gerenciar Serviços")
        with st.expander("➕ Adicionar Novo Serviço"):
            n_serv = st.text_input("Nome do Serviço").strip()
            n_preco = st.number_input("Preço Sugerido", min_value=1.0, value=30.0)
            if st.button("Salvar Serviço"):
                conn = conectar_banco()
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO servicos (nome, preco) VALUES (?,?)", (n_serv, n_preco))
                conn.commit()
                conn.close()
                registrar_log("CONFIG", f"Serviço {n_serv} atualizado.")
                st.success("Salvo!")
                st.rerun()

        st.dataframe(carregar_dados("SELECT * FROM servicos"), use_container_width=True)
        st.write("---")
        st.subheader("🕵️ Logs de Auditoria")
        st.table(carregar_dados("SELECT * FROM logs ORDER BY id DESC LIMIT 15"))

    st.caption("---")
    st.caption(f"🚀 Barber Pro v{__version__} - Sistema de Portfólio (Fins Educativos)")