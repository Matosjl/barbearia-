import requests
import time

API_URL = "https://sua-api-aqui.com/message/sendText"
API_KEY = "SEU_TOKEN_SECRETO_AQUI"
INSTANCE = "sua_instancia"

def enviar_para_recentes():
    # 1. Busca as conversas recentes
    url_chats = f"{API_URL}/chat/findChats/{INSTANCE}"
    headers = {"apikey" : API_KEY}
    
    try:
            response = requests.get(url-chats, headers=headers)
         # Transformamos a resposta em uma lista do Python
        todas_conversas = response.json()
        
        # 2. Pegamos apenas os 100 primeiros (usando fatiamento de lista [:100])
        ultimos_100 = todas_conversas[:100]
        
        print(f"Encontrei {len(ultimos_100)} conversas recentes. Iniciando disparos...")
        
    for i, conversa in enumrerate(ultimos_100, start=1):
            # O número do WhatsApp geralmente vem no campo 'id' ou 'remoteJid'
            numero = conversa['id']
            
            # 3. Enviar a mensagem (chamando a função de texto)
            enviar_mensagem(numero)
            
            print(f"{i}/100 - Cardapio enviado para {numero}")
            time.sleep(3)) # Pausa de segurança
    
        except Exception as e:
             print(f"Erro ao buscar contatos: {e}")
        
        
def enviar_mensagem(numero):