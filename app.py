
import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime
import time

__version__ = "0.0.0.1" # Definição global da versão

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Farmácia Pro v3", layout="wide", page_icon="💊")

# --- FUNÇÕES DE BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('farmacia_v3.db')

def criar_tabelas():
    conn = conectar_banco()
    cursor = conn.cursor()
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS estoque 
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE, qtd INTEGER, preco REAL)''')
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS historico 
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, horario TEXT, cliente TEXT, 
                      produto TEXT, qtd INTEGER, valor_total REAL)''')
    
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
        st.title("🔐 Acesso ao Sistema")
        col1, _ = st.columns(2)
        with col1:
            usuario = st.text_input("Usuário")
            senha = st.text_input("Senha", type="password")
            if st.button("Entrar"):
                if usuario == "admin" and senha == "1234":
                    st.session_state.autenticado = True
                    st.rerun()
                else:
                    st.error("Usuário ou senha incorretos")
        return False
    return True

# --- JANELA DE PAGAMENTO (DIALOG) ---
@st.dialog("Finalizar Pagamento")
def checkout():
    dados = st.session_state.dados_venda
    st.write(f"### Total: R$ {dados['total']:.2f}")
    metodo = st.radio("Forma de Pagamento", ["PIX", "Cartão de Crédito"])

    if metodo == "PIX":
        st.write("Escaneie o QR Code para pagar:")
        st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=SimulacaoPix{dados['total']}")
        st.caption("Chave PIX: farmacia-treino@exemplo.com")
    else:
        st.text_input("Número do Cartão", placeholder="0000 0000 0000 0000")
        c1, c2 = st.columns(2)
        c1.text_input("Validade", placeholder="MM/AA")
        c2.text_input("CVV", placeholder="000")

    if st.button("Confirmar Pagamento"):
        with st.spinner("Processando transação..."):
            time.sleep(2) 
        
        # 1. Grava a Venda
        conn = conectar_banco()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO historico (horario, cliente, produto, qtd, valor_total) VALUES (?,?,?,?,?)",
                       (datetime.now().strftime("%H:%M:%S"), dados['cliente'], dados['produto'], dados['qtd'], dados['total']))
        cursor.execute("UPDATE estoque SET qtd = qtd - ? WHERE nome = ?", (dados['qtd'], dados['produto']))
        conn.commit()
        conn.close()
        
        # 2. Grava o Log (IMPORTANTE: Antes do rerun)
        registrar_log("VENDA", f"Venda de {dados['qtd']}x {dados['produto']} para {dados['cliente']} - R$ {dados['total']:.2f}")
        
        st.success("Pagamento Aprovado!")
        st.balloons()
        time.sleep(1)
        st.rerun()

# --- EXECUÇÃO DO PROGRAMA ---
if login():
    criar_tabelas()

    if st.sidebar.button("🚪 Sair do Sistema"):
        st.session_state.autenticado = False
        st.rerun()

    st.sidebar.markdown("---") # Uma linha divisória
    st.sidebar.caption("📌 **Versão do Sistema:** 0.0.0.1")
    st.sidebar.caption("🛠️ *Ambiente de Desenvolvimento*")

    st.sidebar.markdown("---")
    st.sidebar.caption(f"🚀 Versão: {__version__}")

    st.title("💊 Farmácia Inteligente - Gestão & Performance")
    
    aba1, aba2, aba3 = st.tabs(["🛒 Vendas (PDV)", "📊 Dashboard", "⚙️ Gerencial"])

    with aba1:
        st.subheader("Atendimento ao Cliente")
        df_est = carregar_dados("SELECT * FROM estoque WHERE qtd > 0")
        
        col_f, _ = st.columns([1, 1])
        with col_f:
            nome_c = st.text_input("Nome do Cliente")
            idade = st.number_input("Idade", min_value=0, value=25)
            
            if not df_est.empty:
                prod_sel = st.selectbox("Escolha o Medicamento", df_est['nome'].tolist())
                max_qtd = int(df_est[df_est['nome'] == prod_sel]['qtd'].iloc[0])
                qtd_venda = st.number_input("Quantidade", min_value=1, max_value=max_qtd, value=1)
                
                if st.button("Ir para Pagamento"):
                    preco_u = df_est[df_est['nome'] == prod_sel]['preco'].iloc[0]
                    desc = 0.15 if idade >= 60 else 0.05 if idade <= 18 else 0
                    total = (preco_u * qtd_venda) * (1 - desc)

                    st.session_state.dados_venda = {
                        "cliente": nome_c, "produto": prod_sel, "qtd": qtd_venda, "total": total
                    }
                    checkout()
            else:
                st.warning("Estoque vazio.")

    with aba2:
        st.subheader("Análise de Desempenho")
        df_hist = carregar_dados("SELECT * FROM historico")
        
        if not df_hist.empty:
            c1, c2, c3 = st.columns(3)
            c1.metric("Faturamento Total", f"R$ {df_hist['valor_total'].sum():.2f}")
            c2.metric("Total de Vendas", len(df_hist))
            c3.metric("Média por Venda", f"R$ {df_hist['valor_total'].mean():.2f}")

            fig = px.bar(df_hist.groupby('produto')['qtd'].sum().reset_index(), 
                         x='produto', y='qtd', color='produto', title="Volume de Vendas")
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Nenhuma venda registrada.")

    with aba3:
        st.subheader("Controle de Inventário")
        with st.expander("➕ Adicionar/Repor Produto"):
            n_nome = st.text_input("Nome do Produto").lower().strip()
            n_qtd = st.number_input("Quantidade", min_value=1)
            n_preco = st.number_input("Preço Unitário", min_value=0.1)
            
            if st.button("Gravar no Banco"):
                conn = conectar_banco()
                cursor = conn.cursor()
                cursor.execute('''INSERT INTO estoque (nome, qtd, preco) VALUES (?,?,?)
                                  ON CONFLICT(nome) DO UPDATE SET qtd=qtd+?, preco=?''', 
                               (n_nome, n_qtd, n_preco, n_qtd, n_preco))
                conn.commit()
                conn.close()
                registrar_log("ESTOQUE", f"Produto {n_nome} atualizado. Qtd adicionada: {n_qtd}")
                st.success("Estoque atualizado!")
                st.rerun()

        st.write("### Itens no Sistema")
        st.dataframe(carregar_dados("SELECT * FROM estoque"), use_container_width=True)
        
        # --- EXIBIÇÃO DE LOGS ---
        st.write("---")
        st.subheader("🕵️ Trilha de Auditoria (Logs)")
        df_logs = carregar_dados("SELECT * FROM logs ORDER BY id DESC LIMIT 20")
        st.table(df_logs)
        
        if st.button("🗑️ Limpar Todo o Histórico"):
            conn = conectar_banco()
            conn.execute("DELETE FROM historico")
            conn.commit()
            conn.close()
            registrar_log("SISTEMA", "Histórico de vendas apagado pelo administrador.")
            st.rerun()


    st.caption("---")
    st.caption("🚀 PROJETO PORTFÓLIO: Simulador de Gestão Farmacêutica (Fins Educativos)")
