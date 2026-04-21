
import streamlit as st
import sqlite3
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta, timezone
import time
import requests

# --- CONFIGURAÇÃO WHATSAPP ---
URL_API_GLOBAL = "http://localhost:8080"
TOKEN_GLOBAL = "12345"
INSTANCIA_GLOBAL = "meu_bot"

def enviar_mensagem_api(numero, mensagem):
    headers = {"apikey": TOKEN_GLOBAL, "Content-Type": "application/json"}
    numero_limpo = "".join(filter(str.isdigit, numero))
    if not numero_limpo.endswith("@s.whatsapp.net"):
        if len(numero_limpo) <= 11: numero_limpo = "55" + numero_limpo
        destination = f"{numero_limpo}@s.whatsapp.net"
    else: destination = numero_limpo
    payload = {"number": destination, "text": mensagem}
    try:
        response = requests.post(f"{URL_API_GLOBAL}/message/sendText/{INSTANCIA_GLOBAL}", json=payload, headers=headers)
        return response.status_code in [200, 201]
    except: return False

def obter_data_brasil():
    fuso_br = timezone(timedelta(hours=-3))
    return datetime.now(fuso_br)

# --- CONFIGURAÇÃO VISUAL ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")

# CSS ATUALIZADO: Botões visíveis com fundo dourado e borda branca no hover
st.markdown("""
    <style>
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    h1, h2, h3 { color: #D4AF37 !important; }
    
    /* Estilo padrão dos botões */
    div.stButton > button {
        background-color: #D4AF37; 
        color: black; 
        font-weight: bold;
        border: 1px solid #D4AF37; /* Borda sutil padrão */
    }
    
    /* Estilo ao passar o mouse (Hover) */
    div.stButton > button:hover {
        border: 2px solid white; /* Borda branca no hover */
        background-color: #D4AF37;
        color: black;
    }
    </style>
    """, unsafe_allow_html=True)

# --- BANCO DE DADOS ---
def conectar_banco():
    return sqlite3.connect('barbearia_v1.db')

def criar_tabelas():
    conn = conectar_banco()
    cursor = conn.cursor()
    
    cursor.execute('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE, senha TEXT, nome_barbearia TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS servicos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, nome TEXT, preco REAL)')
    cursor.execute('CREATE TABLE IF NOT EXISTS equipe (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, nome TEXT, celular TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS retiradas (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, data TEXT, valor REAL, motivo TEXT)')
    cursor.execute('CREATE TABLE IF NOT EXISTS agendamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, data TEXT, horario TEXT, cliente TEXT, servico TEXT, telefone TEXT, status TEXT DEFAULT "Pendente")')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS historico_vendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            usuario_id INTEGER, 
            data TEXT, 
            horario TEXT, 
            cliente TEXT, 
            servico TEXT, 
            barbeiro TEXT, 
            valor_total REAL, 
            metodo_pagamento TEXT,
            quantidade INTEGER DEFAULT 1,
            custo_total REAL DEFAULT 0,
            tipo TEXT DEFAULT 'Servico'
        )
    ''')
    
    cursor.execute('CREATE TABLE IF NOT EXISTS estoque (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, produto TEXT, quantidade INTEGER, preco_custo REAL, preco_venda REAL)')
    cursor.execute('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, horario TEXT, usuario TEXT, acao TEXT, detalhes TEXT)')

    # Migrations
    try: cursor.execute('ALTER TABLE equipe ADD COLUMN celular TEXT')
    except: pass
    try: cursor.execute('ALTER TABLE historico_vendas ADD COLUMN metodo_pagamento TEXT')
    except: pass
    try: cursor.execute('ALTER TABLE historico_vendas ADD COLUMN quantidade INTEGER DEFAULT 1')
    except: pass
    try: cursor.execute('ALTER TABLE historico_vendas ADD COLUMN custo_total REAL DEFAULT 0')
    except: pass
    try: cursor.execute('ALTER TABLE historico_vendas ADD COLUMN tipo TEXT DEFAULT "Servico"')
    except: pass

    conn.commit()
    conn.close()

def carregar_dados(query, params=()):
    conn = conectar_banco()
    df = pd.read_sql_query(query, conn, params=params)
    conn.close()
    return df

def registrar_log(usuario_id, acao, detalhes=""):
    conn = conectar_banco()
    conn.execute("INSERT INTO logs (usuario_id, horario, acao, detalhes) VALUES (?, ?, ?, ?)",
                 (usuario_id, obter_data_brasil().strftime("%Y-%m-%d %H:%M:%S"), acao, detalhes))
    conn.commit()
    conn.close()

criar_tabelas()

# --- LÓGICA DE LOGIN ---
if 'autenticado' not in st.session_state: st.session_state.autenticado = False

if not st.session_state.autenticado:
    st.markdown("<h1 style='text-align: center;'>👑 BARBER PRO</h1>", unsafe_allow_html=True)
    t_login, t_cad = st.tabs(["LOGIN", "CADASTRAR"])
    with t_login:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("ENTRAR"):
            res = carregar_dados("SELECT id, nome_barbearia FROM usuarios WHERE login=? AND senha=?", (u, p))
            if not res.empty:
                st.session_state.autenticado = True
                st.session_state.user_id = res.iloc[0]['id']
                st.session_state.nome_loja = res.iloc[0]['nome_barbearia']
                st.session_state.login = u
                registrar_log(st.session_state.user_id, "Login", f"Usuário {u} entrou no sistema.")
                st.rerun()
            else: st.error("Erro de login")
    with t_cad:
        nu = st.text_input("Usuário Novo")
        nn = st.text_input("Nome Barbearia")
        np = st.text_input("Senha Nova", type="password")
        if st.button("CRIAR CONTA"):
            conn = conectar_banco()
            try:
                conn.execute("INSERT INTO usuarios (login, senha, nome_barbearia) VALUES (?,?,?)", (nu, np, nn))
                conn.commit()
                st.success("Criado!")
            except:
                st.error("Usuário já existe")

else:
    # --- INTERFACE LOGADA ---
    hj = obter_data_brasil().strftime("%Y-%m-%d")

    with st.sidebar:
        st.header(f"💈 {st.session_state.nome_loja}")
        if st.button("📅 NOVO AGENDAMENTO"):
            @st.dialog("Novo Agendamento")
            def modal_agendamento():
                d = st.date_input("Data")
                h = st.time_input("Hora")
                c = st.text_input("Cliente")
                t = st.text_input("Whats")
                if st.button("SALVAR"):
                    conn = conectar_banco()
                    conn.execute("INSERT INTO agendamentos (usuario_id, data, horario, cliente, telefone) VALUES (?,?,?,?,?)",
                                 (st.session_state.user_id, d.strftime("%Y-%m-%d"), h.strftime("%H:%M"), c, t))
                    conn.commit()
                    registrar_log(st.session_state.user_id, "Agendamento", f"Cliente {c} agendado para {d}")
                    st.rerun()
            modal_agendamento()
        st.divider()
        if st.button("SAIR"):
            registrar_log(st.session_state.user_id, "Logout", "Usuário saiu do sistema.")
            st.session_state.autenticado = False
            st.rerun()

    # ABAS ATUALIZADAS: Adicionada aba EQUIPE
    t = st.tabs(["✂️ ATENDIMENTO", "📅 AGENDA", "📊 FINANCEIRO", "📦 ESTOQUE", "📈 ANUAL", "💈 EQUIPE", "⚙️ AJUSTES", "🕵️ LOGS"])

    # 1. ATENDIMENTO
    with t[0]:
        st.subheader("Finalizar Serviço")
        df_ag = carregar_dados("SELECT cliente FROM agendamentos WHERE data=? AND status='Pendente' AND usuario_id=?", (hj, st.session_state.user_id))

        c1, c2 = st.columns(2)
        vinc = c1.selectbox("Vínculo Agenda", ["Avulso"] + df_ag['cliente'].tolist())
        nome_c = c2.text_input("Nome Cliente", value="" if vinc == "Avulso" else vinc)

        df_eq = carregar_dados("SELECT nome FROM equipe WHERE usuario_id=?", (st.session_state.user_id,))
        barb = c1.selectbox("Barbeiro", df_eq['nome'].tolist() if not df_eq.empty else ["Cadastre um Barbeiro"])

        df_sv = carregar_dados("SELECT nome, preco FROM servicos WHERE usuario_id=?", (st.session_state.user_id,))
        serv = c2.selectbox("Serviço", df_sv['nome'].tolist() if not df_sv.empty else ["Cadastre um Serviço"])

        if st.button("VENDER / FINALIZAR SERVIÇO"):
            if not df_sv.empty and nome_c:
                vlr = df_sv[df_sv['nome'] == serv]['preco'].values[0]
                st.session_state.venda_atual = {
                    "cliente": nome_c, "barbeiro": barb, "servico": serv, "valor": vlr, "vinculo": vinc
                }
                st.session_state.modal_aberto = True
            else:
                st.warning("Selecione um serviço e preencha o nome do cliente.")

        if st.session_state.get("modal_aberto", False):
            @st.dialog("Finalizar Pagamento", width="stretch")
            def modal_pagamento():
                st.info(f"Serviço: {st.session_state.venda_atual['servico']} | Valor: R$ {st.session_state.venda_atual['valor']:.2f}")
                pag_method = st.selectbox("Pagar com:", ["Dinheiro", "Pix", "Cartão"])
                
                if st.button("CONFIRMAR PAGAMENTO"):
                    conn = conectar_banco()
                    cursor = conn.cursor()
                    cursor.execute("""INSERT INTO historico_vendas 
                        (usuario_id, data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento, tipo) 
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                        (st.session_state.user_id, hj, obter_data_brasil().strftime("%H:%M"), 
                         st.session_state.venda_atual['cliente'], st.session_state.venda_atual['servico'], 
                         st.session_state.venda_atual['barbeiro'], st.session_state.venda_atual['valor'], pag_method, 'Servico'))
                    
                    if st.session_state.venda_atual['vinculo'] != "Avulso":
                        cursor.execute("UPDATE agendamentos SET status='Concluído' WHERE cliente=? AND data=?", 
                                       (st.session_state.venda_atual['vinculo'], hj))
                    
                    conn.commit()
                    conn.close()
                    registrar_log(st.session_state.user_id, "Venda Serviço", f"{st.session_state.venda_atual['servico']} para {st.session_state.venda_atual['cliente']}")
                    st.session_state.modal_aberto = False
                    st.success("Venda concluída!")
                    time.sleep(1)
                    st.rerun()
            modal_pagamento()

    # 2. AGENDA
        # 2. AGENDA (MODIFICADO PARA ENVIAR WHATSAPP)
    with t[1]:
        st.subheader("Clientes Agendados")
        # Carrega dados incluindo o telefone
        df_age = carregar_dados("SELECT id, horario, cliente, telefone, status FROM agendamentos WHERE usuario_id=? AND status='Pendente'", (st.session_state.user_id,))
        
        st.dataframe(df_age[['horario', 'cliente', 'telefone', 'status']], width='stretch', hide_index=True)
        
        st.divider()
        st.subheader("📤 Enviar Lembrete via WhatsApp")
        
        if not df_age.empty:
            c1, c2 = st.columns([2, 1])
            # Seleciona o cliente
            cliente_select = c1.selectbox("Selecione o Cliente", df_age['cliente'].tolist())
            
            # Pega os dados do cliente selecionado
            dados_cliente = df_age[df_age['cliente'] == cliente_select].iloc[0]
            telefone_cliente = dados_cliente['telefone']
            horario_cliente = dados_cliente['horario']
            
            # Monta a mensagem padrão
            msg_template = f"Olá {cliente_select}, tudo bem? Aqui é da {st.session_state.nome_loja}. Passando para confirmar seu agendamento hoje às {horario_cliente}. Estamos te esperando!"
            
            msg_final = st.text_area("Mensagem", value=msg_template, height=100)
            
            if c2.button("ENVIAR MENSAGEM", use_container_width=True):
                if telefone_cliente:
                    # Chama a função de envio
                    with st.spinner("Enviando..."):
                        status_envio = enviar_mensagem_api(telefone_cliente, msg_final)
                    
                    if status_envio:
                        st.success(f"Mensagem enviada com sucesso para {cliente_select}!")
                        registrar_log(st.session_state.user_id, "WhatsApp", f"Enviado para {cliente_select}")
                    else:
                        st.error("Falha ao enviar mensagem. Verifique se a API está online e o Token correto.")
                else:
                    st.warning("Este cliente não possui telefone cadastrado.")
        else:
            st.info("Nenhum agendamento pendente para enviar mensagens.")


    # 3. FINANCEIRO
    with t[2]:
        st.subheader("Fechamento de Caixa")
        v = carregar_dados("SELECT valor_total FROM historico_vendas WHERE usuario_id=?", (st.session_state.user_id,))
        r = carregar_dados("SELECT valor FROM retiradas WHERE usuario_id=?", (st.session_state.user_id,))

        bruto = v['valor_total'].sum()
        com = bruto * 0.5
        sang = r['valor'].sum()

        c1, c2, c3 = st.columns(3)
        c1.metric("FATURAMENTO BRUTO", f"R$ {bruto:.2f}")
        c2.metric("COMISSÃO 50%", f"R$ {com:.2f}")
        c3.metric("SALDO CAIXA", f"R$ {com - sang:.2f}")

        st.divider()
        st.subheader("Sangria (Retirada)")
        v_r = st.number_input("Valor Retirada", min_value=0.0)
        m_r = st.text_input("Motivo")
        if st.button("RETIRAR DINHEIRO"):
            conn = conectar_banco()
            conn.execute("INSERT INTO retiradas (usuario_id, data, valor, motivo) VALUES (?,?,?,?)", (st.session_state.user_id, hj, v_r, m_r))
            conn.commit()
            registrar_log(st.session_state.user_id, "Sangria", f"R$ {v_r:.2f} - {m_r}")
            st.rerun()

    # 4. ESTOQUE
    with t[3]:
        st.subheader("Gestão de Produtos")
        
        with st.expander("➕ ADICIONAR NOVO PRODUTO"):
            c1, c2, c3, c4 = st.columns(4)
            p_n = c1.text_input("Nome Produto")
            p_q = c2.number_input("Quantidade", min_value=0)
            p_c = c3.number_input("Preço Custo", min_value=0.0)
            p_v = c4.number_input("Preço Venda", min_value=0.0)
            if st.button("CADASTRAR PRODUTO"):
                if p_n:
                    conn = conectar_banco()
                    conn.execute("INSERT INTO estoque (usuario_id, produto, quantidade, preco_custo, preco_venda) VALUES (?,?,?,?,?)",
                                 (st.session_state.user_id, p_n, p_q, p_c, p_v))
                    conn.commit()
                    registrar_log(st.session_state.user_id, "Estoque", f"Adicionado: {p_n} ({p_q} un)")
                    st.success("Produto Adicionado!")
                    st.rerun()

        st.divider()
        df_est = carregar_dados("SELECT produto, quantidade, preco_custo, preco_venda FROM estoque WHERE usuario_id=?", (st.session_state.user_id,))
        st.dataframe(df_est, width='stretch')

        # VENDA DE PRODUTOS
        st.divider()
        st.subheader("🛒 Vender Produto")
        
        if 'sale_step' not in st.session_state: st.session_state.sale_step = 1

        if st.session_state.sale_step == 1:
            if not df_est.empty:
                c1, c2 = st.columns(2)
                prod_nome = c1.selectbox("Nome do Produto", df_est['produto'].tolist())
                prod_qtd = c2.number_input("Quantidade", min_value=1, step=1)
                
                if st.button("VENDER"):
                    estoque_atual = df_est[df_est['produto'] == prod_nome]['quantidade'].values[0]
                    if prod_qtd <= estoque_atual:
                        preco_unit = df_est[df_est['produto'] == prod_nome]['preco_venda'].values[0]
                        custo_unit = df_est[df_est['produto'] == prod_nome]['preco_custo'].values[0]
                        
                        st.session_state.sale_prod = prod_nome
                        st.session_state.sale_qtd = prod_qtd
                        st.session_state.sale_total = float(prod_qtd * preco_unit)
                        st.session_state.sale_custo = float(prod_qtd * custo_unit)
                        st.session_state.sale_step = 2
                        st.rerun()
                    else:
                        st.error(f"Estoque insuficiente! Disponível: {estoque_atual}")
            else:
                st.info("Cadastre produtos no estoque para iniciar uma venda.")

        elif st.session_state.sale_step == 2:
            st.info(f"Produto: {st.session_state.sale_prod} | Qtd: {st.session_state.sale_qtd} | Total: R$ {st.session_state.sale_total:.2f}")
            
            with st.form("payment_options"):
                c1, c2 = st.columns(2)
                payment_method = c1.selectbox("Forma de Pagamento", ["Dinheiro", "Pix", "Cartão"])
                v_venda = c2.number_input("Valor da Venda (R$)", min_value=0.0, value=float(st.session_state.sale_total), step=1.0)
                
                submitted = st.form_submit_button("Confirmar Venda")
                if submitted:
                    conn = conectar_banco()
                    cursor = conn.cursor()
                    
                    cursor.execute("""INSERT INTO historico_vendas 
                        (usuario_id, data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento, quantidade, custo_total, tipo) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (st.session_state.user_id, hj, obter_data_brasil().strftime("%H:%M"), "Cliente Balcão", 
                         st.session_state.sale_prod, "Sistema", v_venda, payment_method, 
                         st.session_state.sale_qtd, st.session_state.sale_custo, 'Produto'))
                    
                    cursor.execute("UPDATE estoque SET quantidade = quantidade - ? WHERE produto = ? AND usuario_id = ?",
                                   (st.session_state.sale_qtd, st.session_state.sale_prod, st.session_state.user_id))
                    
                    conn.commit()
                    conn.close()
                    
                    registrar_log(st.session_state.user_id, "Venda Produto", f"{st.session_state.sale_qtd}x {st.session_state.sale_prod}")
                    st.success(f"Venda registrada! Pagamento: {payment_method}")
                    
                    st.session_state.sale_step = 1
                    if 'sale_prod' in st.session_state: del st.session_state.sale_prod
                    if 'sale_qtd' in st.session_state: del st.session_state.sale_qtd
                    if 'sale_total' in st.session_state: del st.session_state.sale_total
                    if 'sale_custo' in st.session_state: del st.session_state.sale_custo
                    time.sleep(1.5)
                    st.rerun()
            
            if st.button("Cancelar Venda"):
                st.session_state.sale_step = 1
                st.rerun()

        # RELATÓRIO
        st.divider()
        st.subheader("📊 Relatório de Produtos Vendidos")
        df_v_prod = carregar_dados("""
            SELECT data, servico as Produto, metodo_pagamento as 'Forma Pgto', 
                   quantidade as Qtd, valor_total as 'Valor Venda', custo_total as 'Valor Custo', 
                   (valor_total - custo_total) as Lucro 
            FROM historico_vendas 
            WHERE usuario_id=? AND tipo='Produto' 
            ORDER BY id DESC""", (st.session_state.user_id,))
        
        if not df_v_prod.empty:
            st.dataframe(df_v_prod, width='stretch')
            total_geral = df_v_prod['Valor Venda'].sum()
            lucro_geral = df_v_prod['Lucro'].sum()
            c1, c2 = st.columns(2)
            c1.metric("Total Vendido em Produtos", f"R$ {total_geral:.2f}")
            c2.metric("Lucro Total (Produtos)", f"R$ {lucro_geral:.2f}")
        else:
            st.info("Nenhum produto vendido ainda.")

    # 5. ANUAL
    with t[4]:
        df_an = carregar_dados("SELECT data, valor_total FROM historico_vendas WHERE usuario_id=?", (st.session_state.user_id,))
        if not df_an.empty:
            df_an['data'] = pd.to_datetime(df_an['data'])
            df_an['Mes'] = df_an['data'].dt.strftime('%b')
            st.plotly_chart(px.bar(df_an.groupby('Mes')['valor_total'].sum().reset_index(), x='Mes', y='valor_total', title="Vendas por Mês", template="plotly_dark"), width='stretch')
        else:
            st.info("Nenhum dado anual lançado ainda.")

    # 6. EQUIPE (NOVA ABA)
    with t[5]:
        st.subheader("Cadastrar Barbeiro")
        c1, c2 = st.columns(2)
        n_e = c1.text_input("Nome do Barbeiro")
        c_e = c2.text_input("Celular")
        if st.button("ADICIONAR BARBEIRO"):
            if n_e:
                conn = conectar_banco()
                conn.execute("INSERT INTO equipe (usuario_id, nome, celular) VALUES (?,?,?)", (st.session_state.user_id, n_e, c_e))
                conn.commit()
                registrar_log(st.session_state.user_id, "Cadastro Barbeiro", f"Barbeiro {n_e} adicionado.")
                st.rerun()

        st.divider()
        df_e_l = carregar_dados("SELECT nome, celular FROM equipe WHERE usuario_id=?", (st.session_state.user_id,))
        st.dataframe(df_e_l, width='stretch')

        st.divider()
        st.subheader("Posição Financeira por Barbeiro")

        if df_e_l.empty:
            st.info("Nenhum barbeiro cadastrado para exibir finanças.")
        else:
            for b_n in df_e_l['nome']:
                with st.expander(f"💰 Financeiro: {b_n}"):
                    v_b = carregar_dados("SELECT data, servico, valor_total FROM historico_vendas WHERE barbeiro=? AND usuario_id=? AND tipo='Servico'", (b_n, st.session_state.user_id))

                    if v_b.empty:
                        st.write("Sem lançamentos para este barbeiro.")
                    else:
                        v_b['Comissão (50%)'] = v_b['valor_total'] * 0.5
                        v_b['data'] = pd.to_datetime(v_b['data'])
                        st.dataframe(v_b[['data', 'servico', 'valor_total', 'Comissão (50%)']], width='stretch')

                        hoje_dt = pd.to_datetime(hj)
                        c_hj = v_b[v_b['data'] == hoje_dt]['Comissão (50%)'].sum()
                        c_7 = v_b[v_b['data'] >= (hoje_dt - timedelta(days=7))]['Comissão (50%)'].sum()
                        c_30 = v_b[v_b['data'] >= (hoje_dt - timedelta(days=30))]['Comissão (50%)'].sum()

                        m1, m2, m3 = st.columns(3)
                        m1.metric("Comissão Hoje", f"R$ {c_hj:.2f}")
                        m2.metric("Últimos 7 Dias", f"R$ {c_7:.2f}")
                        m3.metric("Últimos 30 Dias", f"R$ {c_30:.2f}")

    # 7. AJUSTES (AGORA APENAS SERVIÇOS)
    with t[6]:
        st.subheader("Cadastrar Serviço")
        c1, c2 = st.columns(2)
        n_s = c1.text_input("Nome do Serviço")
        v_s = c2.number_input("Valor R$", min_value=0.0)
        if st.button("ADICIONAR SERVIÇO"):
            if n_s:
                conn = conectar_banco()
                conn.execute("INSERT INTO servicos (usuario_id, nome, preco) VALUES (?,?,?)", (st.session_state.user_id, n_s, v_s))
                conn.commit()
                registrar_log(st.session_state.user_id, "Cadastro Serviço", f"Serviço {n_s} adicionado.")
                st.rerun()

        st.divider()
        df_s_l = carregar_dados("SELECT nome, preco FROM servicos WHERE usuario_id=?", (st.session_state.user_id,))
        st.dataframe(df_s_l, width='stretch')

        st.subheader("Remover Serviço")
        ex_s = st.selectbox("Selecione para Excluir", [""] + df_s_l['nome'].tolist())
        if st.button("REMOVER SERVIÇO"):
            if ex_s:
                conn = conectar_banco()
                conn.execute("DELETE FROM servicos WHERE nome=? AND usuario_id=?", (ex_s, st.session_state.user_id))
                conn.commit()
                registrar_log(st.session_state.user_id, "Remoção Serviço", f"Serviço {ex_s} removido.")
                st.rerun()

    # 8. LOGS
    with t[7]:
        st.subheader("Histórico de Ações do Sistema")
        df_logs = carregar_dados("SELECT horario, acao, detalhes FROM logs WHERE usuario_id=? ORDER BY id DESC", (st.session_state.user_id,))
        st.dataframe(df_logs, width='stretch')
