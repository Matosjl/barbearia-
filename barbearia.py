
import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta, timezone
import time
import requests
from sqlalchemy import create_engine, text


# --- CONEXÃO COM BANCO (SUPABASE) ---
BD_URL = "postgresql://postgres:esqueciasenha@db.zqskdthqrjxdzcvvzbxm.supabase.co:5432/postgres"

# Aqui passamos a variável direta, e não dentro de uma lista []
engine = create_engine(BD_URL)

# --- FUNÇÕES CORE DO BANCO ---
def executar_comando(sql, params=None):
    """Executa INSERT, UPDATE, DELETE no Supabase"""
    with engine.begin() as conn:
        conn.execute(text(sql), params)

@st.cache_data(ttl=600)  # Mantém os dados na memória por 10 minutos
def carregar_dados(query, params=None):
    with engine.connect() as conn:
        df = pd.read_sql_query(text(query), conn, params=params)
    return df
def carregar_dados(query, params=None):
    """Lê dados (SELECT) e retorna um DataFrame"""
    with engine.connect() as conn:
        df = pd.read_sql_query(text(query), conn, params=params)
    return df

def registrar_log(usuario_id, acao, detalhes=""):
    sql = "INSERT INTO logs (usuario_id, horario, acao, detalhes) VALUES (:uid, :hr, :ac, :dt)"
    params = {
        "uid": usuario_id,
        "hr": obter_data_brasil().strftime("%Y-%m-%d %H:%M:%S"),
        "ac": acao,
        "dt": detalhes
    }
    executar_comando(sql, params)

# --- AUXILIARES ---
def obter_data_brasil():
    fuso_br = timezone(timedelta(hours=-3))
    return datetime.now(fuso_br)

def enviar_mensagem_api(numero, mensagem):
    URL_API_GLOBAL =   "https://santa-pentagram-crazed.ngrok-free.dev"
    TOKEN_GLOBAL = "12345"
    INSTANCIA_GLOBAL = "meu_bot"
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

# --- CONFIGURAÇÃO VISUAL ---
st.set_page_config(page_title="Barber Pro Luxury", layout="wide", page_icon="💈")
st.markdown("""
    <style>
    .stApp { background-color: #0E1117; color: #FFFFFF; }
    h1, h2, h3 { color: #D4AF37 !important; }
    div.stButton > button { background-color: #D4AF37; color: black; font-weight: bold; border: 1px solid #D4AF37; }
    div.stButton > button:hover { border: 2px solid white; background-color: #D4AF37; color: black; }
    </style>
    """, unsafe_allow_html=True)

# --- LÓGICA DE LOGIN ---
if 'autenticado' not in st.session_state: st.session_state.autenticado = False

if not st.session_state.autenticado:
    st.markdown("<h1 style='text-align: center;'>👑 BARBER PRO</h1>", unsafe_allow_html=True)
    t_login, t_cad = st.tabs(["LOGIN", "CADASTRAR"])
    
    with t_login:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password", key="senha_login")
        if st.button("ENTRAR"):
            query = "SELECT id, nome_barbearia FROM usuarios WHERE login = :u AND senha = :p"
            res = carregar_dados(query, {"u": u, "p": p})
            if not res.empty:
                st.session_state.autenticado = True
                st.session_state.user_id = int(res.iloc[0]['id'])
                st.session_state.nome_loja = res.iloc[0]['nome_barbearia']
                st.session_state.login = u
                registrar_log(st.session_state.user_id, "Login", f"Usuário {u} entrou no sistema.")
                st.rerun()
            else: st.error("Usuário ou senha incorretos")

    with t_cad:
        nu = st.text_input("Novo Usuário")
        nn = st.text_input("Nome da Barbearia")
        np = st.text_input("Senha", type="password", key="senha_cadastro")
        if st.button("CRIAR CONTA"):
            try:
                sql = "INSERT INTO usuarios (login, senha, nome_barbearia) VALUES (:u, :s, :n)"
                executar_comando(sql, {"u": nu, "s": np, "n": nn})
                st.success("Conta criada com sucesso! Vá para a aba Login.")
            except: st.error("Este usuário já existe.")

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
                t = st.text_input("WhatsApp")
                if st.button("SALVAR"):
                    sql = "INSERT INTO agendamentos (usuario_id, data, horario, cliente, telefone, status) VALUES (:uid, :dt, :hr, :cli, :tel, 'Pendente')"
                    executar_comando(sql, {"uid": st.session_state.user_id, "dt": d, "hr": h.strftime("%H:%M"), "cli": c, "tel": t})
                    registrar_log(st.session_state.user_id, "Agendamento", f"Cliente {c} para {d}")
                    st.rerun()
            modal_agendamento()
        
        st.divider()
        if st.button("SAIR"):
            registrar_log(st.session_state.user_id, "Logout", "Usuário saiu do sistema.")
            st.session_state.autenticado = False
            st.rerun()

    tabs = st.tabs(["✂️ ATENDIMENTO", "📅 AGENDA", "📊 FINANCEIRO", "📦 ESTOQUE", "📈 ANUAL", "💈 EQUIPE", "⚙️ AJUSTES", "🕵️ LOGS"])

    # 1. ATENDIMENTO
    with tabs[0]:
        st.subheader("Finalizar Serviço")
        df_age = carregar_dados("SELECT cliente FROM agendamentos WHERE usuario_id = :uid AND data = :d AND status = 'Pendente'", {"uid": st.session_state.user_id, "d": hj})
        
        c1, c2 = st.columns(2)
        vinc = c1.selectbox("Vínculo Agenda", ["Avulso"] + (df_age['cliente'].tolist() if not df_age.empty else []))
        nome_c = c2.text_input("Nome Cliente", value="" if vinc == "Avulso" else vinc)

        df_eq = carregar_dados("SELECT nome FROM equipe WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        barb = c1.selectbox("Barbeiro", df_eq['nome'].tolist() if not df_eq.empty else ["Cadastre um Barbeiro"])

        df_sv = carregar_dados("SELECT nome, preco FROM servicos WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        serv = c2.selectbox("Serviço", df_sv['nome'].tolist() if not df_sv.empty else ["Cadastre um Serviço"])

        if st.button("VENDER / FINALIZAR SERVIÇO"):
            if not df_sv.empty and nome_c:
                vlr = float(df_sv[df_sv['nome'] == serv]['preco'].values[0])
                st.session_state.venda_atual = {
                    "cliente": nome_c, "barbeiro": barb, "servico": serv, "valor": vlr, "vinculo": vinc
                }
                st.session_state.modal_aberto = True
                st.rerun()
            else:
                st.warning("Selecione um serviço e preencha o nome do cliente.")

        if st.session_state.get("modal_aberto", False):
            @st.dialog("Finalizar Pagamento", width="stretch")
            def modal_pagamento():
                st.info(f"Serviço: {st.session_state.venda_atual['servico']} | Valor: R$ {st.session_state.venda_atual['valor']:.2f}")
                pag_method = st.selectbox("Pagar com:", ["Dinheiro", "Pix", "Cartão"])
                
                if st.button("CONFIRMAR PAGAMENTO"):
                    sql_venda = """INSERT INTO historico_vendas 
                        (usuario_id, data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento, tipo) 
                        VALUES (:uid, :dt, :hr, :cli, :srv, :bar, :vlr, :pag, 'Servico')"""
                    
                    executar_comando(sql_venda, {
                        "uid": st.session_state.user_id, "dt": hj, "hr": obter_data_brasil().strftime("%H:%M"), 
                        "cli": st.session_state.venda_atual['cliente'], "srv": st.session_state.venda_atual['servico'], 
                        "bar": st.session_state.venda_atual['barbeiro'], "vlr": st.session_state.venda_atual['valor'], 
                        "pag": pag_method
                    })
                    
                    if st.session_state.venda_atual['vinculo'] != "Avulso":
                        executar_comando("UPDATE agendamentos SET status='Concluído' WHERE cliente=:cli AND data=:dt", 
                                         {"cli": st.session_state.venda_atual['vinculo'], "dt": hj})
                    
                    registrar_log(st.session_state.user_id, "Venda Serviço", f"{st.session_state.venda_atual['servico']} para {st.session_state.venda_atual['cliente']}")
                    st.session_state.modal_aberto = False
                    st.success("Venda concluída!")
                    time.sleep(1)
                    st.rerun()
            modal_pagamento()

    # 2. AGENDA
    with tabs[1]:
        st.subheader("Clientes Agendados")
        df_ag = carregar_dados("SELECT id, horario, cliente, telefone, status FROM agendamentos WHERE usuario_id = :uid AND status = 'Pendente'", {"uid": st.session_state.user_id})
        
        st.dataframe(df_ag[['horario', 'cliente', 'telefone', 'status']], use_container_width=True, hide_index=True)
        
        st.divider()
        st.subheader("📤 Enviar Lembrete via WhatsApp")
        
        if not df_ag.empty:
            c1, c2 = st.columns([2, 1])
            cliente_select = c1.selectbox("Selecione o Cliente", df_ag['cliente'].tolist())
            
            # Pega dados do cliente selecionado
            dados_cliente = df_ag[df_ag['cliente'] == cliente_select].iloc[0]
            telefone_cliente = str(dados_cliente['telefone'])
            horario_cliente = dados_cliente['horario']
            
            msg_template = f"Olá {cliente_select}, tudo bem? Aqui é da {st.session_state.nome_loja}. Passando para confirmar seu agendamento hoje às {horario_cliente}. Estamos te esperando!"
            msg_final = st.text_area("Mensagem", value=msg_template, height=100)
            
            if c2.button("ENVIAR MENSAGEM", use_container_width=True):
                if telefone_cliente:
                    with st.spinner("Enviando..."):
                        status_envio = enviar_mensagem_api(telefone_cliente, msg_final)
                    if status_envio:
                        st.success(f"Mensagem enviada para {cliente_select}!")
                        registrar_log(st.session_state.user_id, "WhatsApp", f"Enviado para {cliente_select}")
                    else:
                        st.error("Falha ao enviar mensagem.")
                else:
                    st.warning("Cliente sem telefone cadastrado.")
        else:
            st.info("Nenhum agendamento pendente.")

    # 3. FINANCEIRO
    with tabs[2]:
        st.subheader("Fechamento de Caixa")
        v = carregar_dados("SELECT valor_total FROM historico_vendas WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        r = carregar_dados("SELECT valor FROM retiradas WHERE usuario_id = :uid", {"uid": st.session_state.user_id})

        bruto = v['valor_total'].sum() if not v.empty else 0
        com = bruto * 0.5
        sang = r['valor'].sum() if not r.empty else 0

        c1, c2, c3 = st.columns(3)
        c1.metric("FATURAMENTO BRUTO", f"R$ {bruto:.2f}")
        c2.metric("COMISSÃO 50%", f"R$ {com:.2f}")
        c3.metric("SALDO CAIXA", f"R$ {com - sang:.2f}")

        st.divider()
        st.subheader("Sangria (Retirada)")
        v_r = st.number_input("Valor Retirada", min_value=0.0)
        m_r = st.text_input("Motivo")
        if st.button("RETIRAR DINHEIRO"):
            sql = "INSERT INTO retiradas (usuario_id, data, valor, motivo) VALUES (:uid, :dt, :vlr, :mot)"
            executar_comando(sql, {"uid": st.session_state.user_id, "dt": hj, "vlr": v_r, "mot": m_r})
            registrar_log(st.session_state.user_id, "Sangria", f"R$ {v_r:.2f} - {m_r}")
            st.rerun()

    # 4. ESTOQUE
    with tabs[3]:
        st.subheader("Gestão de Produtos")
        
        with st.expander("➕ ADICIONAR NOVO PRODUTO"):
            c1, c2, c3, c4 = st.columns(4)
            p_n = c1.text_input("Nome Produto")
            p_q = c2.number_input("Quantidade", min_value=0)
            p_c = c3.number_input("Preço Custo", min_value=0.0)
            p_v = c4.number_input("Preço Venda", min_value=0.0)
            if st.button("CADASTRAR PRODUTO"):
                if p_n:
                    sql = "INSERT INTO estoque (usuario_id, produto, quantidade, preco_custo, preco_venda) VALUES (:uid, :p, :q, :c, :v)"
                    executar_comando(sql, {"uid": st.session_state.user_id, "p": p_n, "q": p_q, "c": p_c, "v": p_v})
                    registrar_log(st.session_state.user_id, "Estoque", f"Adicionado: {p_n} ({p_q} un)")
                    st.success("Produto Adicionado!")
                    st.rerun()

        st.divider()
        df_est = carregar_dados("SELECT produto, quantidade, preco_custo, preco_venda FROM estoque WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        st.dataframe(df_est, use_container_width=True)

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
                st.info("Cadastre produtos para iniciar uma venda.")

        elif st.session_state.sale_step == 2:
            st.info(f"Produto: {st.session_state.sale_prod} | Qtd: {st.session_state.sale_qtd} | Total: R$ {st.session_state.sale_total:.2f}")
            
            with st.form("payment_options"):
                c1, c2 = st.columns(2)
                payment_method = c1.selectbox("Forma de Pagamento", ["Dinheiro", "Pix", "Cartão"])
                v_venda = c2.number_input("Valor da Venda (R$)", min_value=0.0, value=float(st.session_state.sale_total), step=1.0)
                
                submitted = st.form_submit_button("Confirmar Venda")
                if submitted:
                    # Insere venda
                    sql_v = """INSERT INTO historico_vendas 
                        (usuario_id, data, horario, cliente, servico, barbeiro, valor_total, metodo_pagamento, quantidade, custo_total, tipo) 
                        VALUES (:uid, :dt, :hr, 'Cliente Balcão', :prod, 'Sistema', :vlr, :pag, :qtd, :custo, 'Produto')"""
                    executar_comando(sql_v, {
                        "uid": st.session_state.user_id, "dt": hj, "hr": obter_data_brasil().strftime("%H:%M"), 
                        "prod": st.session_state.sale_prod, "vlr": v_venda, "pag": payment_method, 
                        "qtd": st.session_state.sale_qtd, "custo": st.session_state.sale_custo
                    })
                    
                    # Atualiza estoque
                    sql_up = "UPDATE estoque SET quantidade = quantidade - :q WHERE produto = :p AND usuario_id = :uid"
                    executar_comando(sql_up, {"q": st.session_state.sale_qtd, "p": st.session_state.sale_prod, "uid": st.session_state.user_id})
                    
                    registrar_log(st.session_state.user_id, "Venda Produto", f"{st.session_state.sale_qtd}x {st.session_state.sale_prod}")
                    st.success(f"Venda registrada! Pagamento: {payment_method}")
                    
                    st.session_state.sale_step = 1
                    if 'sale_prod' in st.session_state: del st.session_state.sale_prod
                    if 'sale_qtd' in st.session_state: del st.session_state.sale_qtd
                    time.sleep(1.5)
                    st.rerun()
            
            if st.button("Cancelar Venda"):
                st.session_state.sale_step = 1
                st.rerun()

        # Relatório de Produtos
                # RELATÓRIO (CORRIGIDO PARA POSTGRES/SUPABASE)
        st.divider()
        st.subheader("📊 Relatório de Produtos Vendidos")
        
        # Nota: Usamos aspas duplas " " para aliases com espaço no PostgreSQL
        query_prod = """
            SELECT data, servico as Produto, metodo_pagamento as "Forma Pgto", 
                   quantidade as Qtd, valor_total as "Valor Venda", custo_total as "Valor Custo", 
                   (valor_total - custo_total) as Lucro 
            FROM historico_vendas 
            WHERE usuario_id = :uid AND tipo = 'Produto' 
            ORDER BY id DESC
        """
        
        df_v_prod = carregar_dados(query_prod, {"uid": st.session_state.user_id})
        
        if not df_v_prod.empty:
            st.dataframe(df_v_prod, use_container_width=True)
            total_geral = df_v_prod['Valor Venda'].sum()
            lucro_geral = df_v_prod['Lucro'].sum()
            c1, c2 = st.columns(2)
            c1.metric("Total Vendido em Produtos", f"R$ {total_geral:.2f}")
            c2.metric("Lucro Total (Produtos)", f"R$ {lucro_geral:.2f}")
        else:
            st.info("Nenhum produto vendido ainda.")


    # 5. ANUAL
    with tabs[4]:
        df_an = carregar_dados("SELECT data, valor_total FROM historico_vendas WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        if not df_an.empty:
            df_an['data'] = pd.to_datetime(df_an['data'])
            df_an['Mes'] = df_an['data'].dt.strftime('%b')
            st.plotly_chart(px.bar(df_an.groupby('Mes')['valor_total'].sum().reset_index(), x='Mes', y='valor_total', title="Vendas por Mês", template="plotly_dark"), use_container_width=True)
        else:
            st.info("Nenhum dado anual lançado ainda.")

    # 6. EQUIPE
    with tabs[5]:
        st.subheader("Cadastrar Barbeiro")
        c1, c2 = st.columns(2)
        n_e = c1.text_input("Nome do Barbeiro")
        c_e = c2.text_input("Celular")
        if st.button("ADICIONAR BARBEIRO"):
            if n_e:
                sql = "INSERT INTO equipe (usuario_id, nome, celular) VALUES (:uid, :n, :c)"
                executar_comando(sql, {"uid": st.session_state.user_id, "n": n_e, "c": c_e})
                registrar_log(st.session_state.user_id, "Cadastro Barbeiro", f"Barbeiro {n_e} adicionado.")
                st.rerun()

        st.divider()
        df_e_l = carregar_dados("SELECT nome, celular FROM equipe WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        st.dataframe(df_e_l, use_container_width=True)

        st.divider()
        st.subheader("Posição Financeira por Barbeiro")

        if df_e_l.empty:
            st.info("Nenhum barbeiro cadastrado para exibir finanças.")
        else:
            for b_n in df_e_l['nome']:
                with st.expander(f"💰 Financeiro: {b_n}"):
                    v_b = carregar_dados("SELECT data, servico, valor_total FROM historico_vendas WHERE barbeiro = :b AND usuario_id = :uid AND tipo = 'Servico'", {"b": b_n, "uid": st.session_state.user_id})

                    if v_b.empty:
                        st.write("Sem lançamentos para este barbeiro.")
                    else:
                        v_b['Comissão (50%)'] = v_b['valor_total'] * 0.5
                        v_b['data'] = pd.to_datetime(v_b['data'])
                        st.dataframe(v_b[['data', 'servico', 'valor_total', 'Comissão (50%)']], use_container_width=True)

                        hoje_dt = pd.to_datetime(hj)
                        c_hj = v_b[v_b['data'] == hoje_dt]['Comissão (50%)'].sum()
                        c_7 = v_b[v_b['data'] >= (hoje_dt - timedelta(days=7))]['Comissão (50%)'].sum()
                        c_30 = v_b[v_b['data'] >= (hoje_dt - timedelta(days=30))]['Comissão (50%)'].sum()

                        m1, m2, m3 = st.columns(3)
                        m1.metric("Comissão Hoje", f"R$ {c_hj:.2f}")
                        m2.metric("Últimos 7 Dias", f"R$ {c_7:.2f}")
                        m3.metric("Últimos 30 Dias", f"R$ {c_30:.2f}")

    # 7. AJUSTES
    with tabs[6]:
        st.subheader("Cadastrar Serviço")
        c1, c2 = st.columns(2)
        n_s = c1.text_input("Nome do Serviço")
        v_s = c2.number_input("Valor R$", min_value=0.0)
        if st.button("ADICIONAR SERVIÇO"):
            if n_s:
                sql = "INSERT INTO servicos (usuario_id, nome, preco) VALUES (:uid, :n, :v)"
                executar_comando(sql, {"uid": st.session_state.user_id, "n": n_s, "v": v_s})
                registrar_log(st.session_state.user_id, "Cadastro Serviço", f"Serviço {n_s} adicionado.")
                st.rerun()

        st.divider()
        df_s_l = carregar_dados("SELECT nome, preco FROM servicos WHERE usuario_id = :uid", {"uid": st.session_state.user_id})
        st.dataframe(df_s_l, use_container_width=True)

        st.subheader("Remover Serviço")
        ex_s = st.selectbox("Selecione para Excluir", [""] + df_s_l['nome'].tolist())
        if st.button("REMOVER SERVIÇO"):
            if ex_s:
                executar_comando("DELETE FROM servicos WHERE nome = :n AND usuario_id = :uid", {"n": ex_s, "uid": st.session_state.user_id})
                registrar_log(st.session_state.user_id, "Remoção Serviço", f"Serviço {ex_s} removido.")
                st.rerun()

    # 8. LOGS
    with tabs[7]:
        st.subheader("Histórico de Ações do Sistema")
        df_logs = carregar_dados("SELECT horario, acao, detalhes FROM logs WHERE usuario_id = :uid ORDER BY id DESC", {"uid": st.session_state.user_id})
        st.dataframe(df_logs, use_container_width=True)