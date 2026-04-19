estoque = {
    "ibuprofeno": {"qtd": 10, "preco": 15.50},
    "dipirona": {"qtd": 12, "preco": 8.00},
    "diclofenaco": {"qtd": 9, "preco": 22.90}
}

def calcular_preco_com_desconto(preco_unidade, qtd, idade_cliente):
    preco_total_bruto = preco_unidade * qtd
    if idade_cliente >= 60:
        return preco_total_bruto * 0.85
    elif idade_cliente <= 18:
        return preco_total_bruto * 0.95
    else:
        return preco_total_bruto

def vender_produto(nome_cliente, nome_remedio, qtd_venda, idade_usuario):
    remedio_busca = nome_remedio.lower()
    
    if remedio_busca in estoque:
        dados = estoque[remedio_busca]
        
        if dados["qtd"] >= qtd_venda:
            preco_unitario = dados["preco"]
            preco_bruto = preco_unitario * qtd_venda
            preco_final = calcular_preco_com_desconto(preco_unitario, qtd_venda, idade_usuario)
            valor_desconto = preco_bruto - preco_final
            
            # Baixa no estoque
            estoque[remedio_busca]["qtd"] -= qtd_venda
            
            # Cupom Fiscal Personalizado
            print(f"\n" + "="*30)
            print(f"   FARMÁCIA GEMINI - RECIBO")
            print(f"="*30)
            print(f"Cliente: {nome_cliente.upper()}")
            print(f"Produto: {remedio_busca.upper()}")
            print(f"Qtd:     {qtd_venda}")
            print(f"-"*30)
            print(f"Total Bruto:     R$ {preco_bruto:.2f}")
            print(f"Desconto:        R$ {valor_desconto:.2f}")
            print(f"TOTAL A PAGAR:   R$ {preco_final:.2f}")
            print(f"="*30)
            
            if estoque[remedio_busca]["qtd"] < 5:
                print(f"⚠️  ALERTA: Estoque de {remedio_busca.upper()} está baixo ({estoque[remedio_busca]['qtd']} restantes).")
        else:
            print(f"\nOlá {nome_cliente}, infelizmente só temos {dados['qtd']} unidades de {nome_remedio}.")
    else:
        print(f"\nDesculpe {nome_cliente}, o produto '{nome_remedio}' não foi encontrado.")

# --- ENTRADA DE DADOS ---
while True:
    try:
        print("\n--- NOVO ATENDIMENTO ---")
        usuario = input("Qual o nome do cliente? ")
        idade = int(input(f"Qual a idade de {usuario}? "))
        remedio = input("Qual remédio deseja comprar? ")
        quantidade = int(input(f"Quantas unidades de {remedio}? "))

        vender_produto(usuario, remedio, quantidade, idade)

    except ValueError:
        print("Erro: Digite valores válidos.")

    # AQUI ESTÁ A LÓGICA DO "DO WHILE"
    # O código executou uma vez e agora pergunta se deve continuar
    continuar = input("\nDeseja realizar outra venda? (s/n): ").lower()
    if continuar != 's':
        print("Encerrando o sistema... Até logo!")
        break # Sai do loop