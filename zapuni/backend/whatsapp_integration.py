import requests
import json
import os
import logging
import time
import asyncio
from typing import Dict, Any, Optional

# Configurar logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WhatsAppBot:
    def __init__(self, service_url: str = None):
        """
        Inicializa o bot do WhatsApp
        
        :param service_url: URL do serviço WhatsApp
        """
        self.service_url = service_url or os.environ.get("WHATSAPP_SERVICE_URL", "http://localhost:8080")
        self.connected = False
        self.heartbeat_task = None
        self.reconnect_in_progress = False
        self.last_successful_ping = 0
        logger.info(f"WhatsAppBot inicializado com serviço em: {self.service_url}")

    async def connect(self) -> bool:
        """
        Verifica a conexão com o serviço do WhatsApp
        
        :return: True se conectado, False caso contrário
        """
        if self.reconnect_in_progress:
            logger.info("Reconexão já em andamento, aguardando...")
            return self.connected
            
        self.reconnect_in_progress = True
        try:
            # Verificar se o serviço está disponível primeiro
            try:
                ping_response = requests.get(f"{self.service_url}/ping", timeout=5)
                if ping_response.status_code != 200:
                    logger.warning(f"Ping falhou com status {ping_response.status_code}")
            except Exception as ping_err:
                logger.warning(f"Não foi possível fazer ping no serviço: {str(ping_err)}")
                
            response = requests.get(f"{self.service_url}/status", timeout=10)
            data = response.json()
            previous_state = self.connected
            self.connected = data.get('connected', False)
            
            if not self.connected:
                # Tentar iniciar o serviço
                logger.info("Serviço não conectado, tentando iniciar...")
                start_response = requests.get(f"{self.service_url}/start", timeout=15)
                logger.info(f"Tentativa de iniciar serviço WhatsApp: {start_response.json()}")
                
                # Aguardar um momento para o serviço iniciar
                await asyncio.sleep(3)
                
                # Verificar novamente o status após tentar iniciar
                for retry in range(3):  # Tentar até 3 vezes
                    try:
                        response = requests.get(f"{self.service_url}/status", timeout=10)
                        data = response.json()
                        self.connected = data.get('connected', False)
                        if self.connected:
                            break
                        logger.info(f"Tentativa {retry+1} de verificar status após início: {data}")
                        await asyncio.sleep(2)  # Pequeno atraso entre tentativas
                    except Exception as retry_err:
                        logger.error(f"Erro na tentativa {retry+1} de verificar status: {str(retry_err)}")
            
            logger.info(f"Status da conexão WhatsApp: {data}")
            
            # Iniciar heartbeat se conectado e ainda não está rodando
            if self.connected and (not self.heartbeat_task or self.heartbeat_task.done()):
                self.start_heartbeat()
                
            # Se mudou de desconectado para conectado, log de sucesso
            if not previous_state and self.connected:
                logger.info("Conexão estabelecida com o serviço WhatsApp!")
                
            return self.connected
        except Exception as e:
            logger.error(f"Erro ao conectar com serviço WhatsApp: {str(e)}")
            self.connected = False
            return False
        finally:
            self.reconnect_in_progress = False

    def start_heartbeat(self):
        """
        Inicia o processo de heartbeat para manter a conexão ativa
        """
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            logger.info("Iniciado heartbeat para manter a conexão WhatsApp ativa")

    async def _heartbeat_loop(self):
        """
        Loop de heartbeat que envia um ping periódico para manter a conexão viva
        """
        try:
            while True:  # Sempre continuar o heartbeat
                if not self.connected:
                    logger.info("Heartbeat detectou desconexão, tentando reconectar...")
                    await self.connect()
                    await asyncio.sleep(5)
                    continue
                
                try:
                    current_time = time.time()
                    # Se o último ping bem-sucedido foi há mais de 2 minutos, provável que tenhamos problemas
                    if self.last_successful_ping > 0 and current_time - self.last_successful_ping > 120:
                        logger.warning(f"Último ping bem-sucedido foi há {current_time - self.last_successful_ping:.1f}s. Forçando reconexão.")
                        await self.connect()
                        await asyncio.sleep(5)
                        continue
                        
                    logger.debug("Enviando heartbeat para o serviço WhatsApp")
                    
                    # Primeiro tentar ping, que é mais leve
                    ping_response = requests.get(f"{self.service_url}/ping", timeout=5)
                    if ping_response.status_code == 200:
                        self.last_successful_ping = time.time()
                        
                    # A cada 5 heartbeats, verificar o status completo
                    if int(time.time()) % 150 < 30:  # Aproximadamente a cada 2.5 minutos
                        status_response = requests.get(f"{self.service_url}/status", timeout=5)
                        data = status_response.json()
                        self.connected = data.get('connected', False)
                        
                        # Se o browserless foi reiniciado, ele pode relatar "connected" mesmo que a sessão WhatsApp esteja perdida
                        # Nesse caso, forçamos uma reconexão
                        if self.connected and data.get('status') != 'ready':
                            logger.warning(f"Status WhatsApp anômalo: {data.get('status')}. Forçando reconexão.")
                            await self.connect()
                    
                except Exception as e:
                    logger.error(f"Erro durante heartbeat: {str(e)}")
                    # Erro no heartbeat indica problema de conexão
                    self.connected = False
                    await asyncio.sleep(5)  # Esperar um pouco antes de tentar reconectar
                    await self.connect()
                    
                # Esperar 30 segundos antes do próximo heartbeat
                await asyncio.sleep(30)
                
        except asyncio.CancelledError:
            logger.info("Heartbeat loop cancelado")
        except Exception as e:
            logger.error(f"Erro não tratado no loop de heartbeat: {str(e)}")
            # Tentar reiniciar o heartbeat
            await asyncio.sleep(10)
            self.start_heartbeat()

    async def send_message(self, phone_number: str, message: str, metadata: dict = None) -> Dict[str, Any]:
        """
        Envia mensagem para um número de WhatsApp
        
        :param phone_number: Número de telefone no formato internacional
        :param message: Texto da mensagem
        :param metadata: Dados adicionais para rastreamento (opcional)
        :return: Resposta da API
        """
        if not phone_number:
            return {"success": False, "error": "Número de telefone não fornecido"}
        
        # Verificar se está conectado antes de enviar
        if not self.connected:
            logger.warning("Tentando reconectar antes de enviar mensagem...")
            reconnected = await self.connect()
            if not reconnected:
                # Tentar mais uma vez após um breve atraso
                await asyncio.sleep(5)
                reconnected = await self.connect()
                if not reconnected:
                    return {"success": False, "error": "Não foi possível conectar ao WhatsApp"}
        
        # Formatar o número (remover formatação e manter apenas dígitos)
        formatted_number = ''.join(filter(str.isdigit, phone_number))
        if not formatted_number.endswith('@c.us') and not '@g.us' in formatted_number:
            if not formatted_number.startswith('55'):
                formatted_number = '55' + formatted_number  # Garantir código do país
        
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                payload = {
                    "jid": formatted_number,
                    "text": message
                }
                
                if metadata:
                    payload["metadata"] = metadata
                
                logger.info(f"Enviando mensagem para {formatted_number}")
                
                response = requests.post(
                    f"{self.service_url}/send", 
                    json=payload,
                    timeout=15
                )
                
                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Mensagem enviada com sucesso: {result}")
                    self.last_successful_ping = time.time()  # Atualizar timestamp de última atividade bem-sucedida
                    return {"success": True, "data": result}
                else:
                    logger.error(f"Erro ao enviar mensagem. Status: {response.status_code}, Resposta: {response.text}")
                    
                    # Verificar se o erro é relacionado à sessão fechada
                    session_closed = False
                    try:
                        response_text = response.text.lower()
                        session_closed = "session closed" in response_text or "protocol error" in response_text or "not connected" in response_text
                    except:
                        pass
                        
                    if session_closed:
                        logger.warning("Sessão fechada detectada, tentando reconectar...")
                        self.connected = False  # Força o estado para desconectado
                        reconnected = await self.connect()
                        
                        if reconnected:
                            logger.info("Reconectado com sucesso, tentando enviar mensagem novamente")
                            retry_count += 1
                            continue  # Continuar para a próxima iteração do loop
                        else:
                            logger.error("Falha ao reconectar")
                    
                    return {"success": False, "error": f"Erro HTTP {response.status_code}: {response.text}"}
                
            except Exception as e:
                logger.error(f"Exceção ao enviar mensagem: {str(e)}")
                
                # Determinar se devemos tentar novamente
                if retry_count < max_retries - 1:
                    logger.info(f"Tentando novamente ({retry_count + 1}/{max_retries})...")
                    retry_count += 1
                    await asyncio.sleep(3)  # Breve espera entre tentativas
                else:
                    return {"success": False, "error": str(e)}
    
    async def send_image(self, phone_number: str, image_path: str, caption: str = None) -> Dict[str, Any]:
        """
        Envia uma imagem para um número de WhatsApp
        
        :param phone_number: Número de telefone no formato internacional
        :param image_path: Caminho para o arquivo de imagem
        :param caption: Legenda opcional para a imagem
        :return: Resposta da API
        """
        if not phone_number:
            return {"success": False, "error": "Número de telefone não fornecido"}
        
        if not os.path.exists(image_path):
            return {"success": False, "error": f"Arquivo de imagem não encontrado: {image_path}"}
        
        # Verificar se está conectado antes de enviar
        if not self.connected:
            logger.warning("Tentando reconectar antes de enviar imagem...")
            reconnected = await self.connect()
            if not reconnected:
                # Tentar mais uma vez após um breve atraso
                await asyncio.sleep(5)
                reconnected = await self.connect()
                if not reconnected:
                    return {"success": False, "error": "Não foi possível conectar ao WhatsApp"}
        
        # Formatar o número (remover formatação e manter apenas dígitos)
        formatted_number = ''.join(filter(str.isdigit, phone_number))
        if not formatted_number.endswith('@c.us') and not '@g.us' in formatted_number:
            if not formatted_number.startswith('55'):
                formatted_number = '55' + formatted_number  # Garantir código do país
        
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                # Ler o arquivo de imagem
                with open(image_path, "rb") as image_file:
                    files = {
                        'file': (os.path.basename(image_path), image_file, 'image/jpeg')
                    }
                    
                    # Preparar os dados de formulário
                    data = {
                        'jid': formatted_number
                    }
                    
                    # Adicionar legenda se fornecida
                    if caption:
                        data['caption'] = caption
                    
                    logger.info(f"Enviando imagem para {formatted_number}")
                    
                    # Enviar requisição para o endpoint de envio de imagem
                    response = requests.post(
                        f"{self.service_url}/send-image", 
                        data=data,
                        files=files,
                        timeout=15
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        logger.info(f"Imagem enviada com sucesso: {result}")
                        self.last_successful_ping = time.time()  # Atualizar timestamp de última atividade bem-sucedida
                        return {"success": True, "data": result}
                    else:
                        logger.error(f"Erro ao enviar imagem. Status: {response.status_code}, Resposta: {response.text}")
                        
                        # Verificar se o erro é relacionado à sessão fechada
                        session_closed = False
                        try:
                            response_text = response.text.lower()
                            session_closed = "session closed" in response_text or "protocol error" in response_text or "not connected" in response_text
                        except:
                            pass
                            
                        if session_closed:
                            logger.warning("Sessão fechada detectada, tentando reconectar...")
                            self.connected = False  # Força o estado para desconectado
                            reconnected = await self.connect()
                            
                            if reconnected:
                                logger.info("Reconectado com sucesso, tentando enviar imagem novamente")
                                retry_count += 1
                                continue  # Continuar para a próxima iteração do loop
                            else:
                                logger.error("Falha ao reconectar")
                        
                        return {"success": False, "error": f"Erro HTTP {response.status_code}: {response.text}"}
                    
            except Exception as e:
                logger.error(f"Exceção ao enviar imagem: {str(e)}")
                
                # Determinar se devemos tentar novamente
                if retry_count < max_retries - 1:
                    logger.info(f"Tentando novamente ({retry_count + 1}/{max_retries})...")
                    retry_count += 1
                    await asyncio.sleep(3)  # Breve espera entre tentativas
                else:
                    return {"success": False, "error": str(e)}

    async def get_contact_info(self, phone_number: str) -> Dict[str, Any]:
        """
        Obtém informações de um contato do WhatsApp
        
        :param phone_number: Número de telefone no formato internacional
        :return: Informações do contato
        """
        if not phone_number:
            return {"success": False, "error": "Número de telefone não fornecido"}
        
        # Verificar se está conectado antes de buscar informações
        if not self.connected:
            await self.connect()
        
        # Formatar o número (remover formatação e manter apenas dígitos)
        formatted_number = ''.join(filter(str.isdigit, phone_number))
        
        try:
            logger.info(f"Obtendo informações do contato {formatted_number}")
            
            response = requests.get(
                f"{self.service_url}/contact-info/{formatted_number}",
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"Informações de contato obtidas com sucesso: {result}")
                return result
            else:
                logger.error(f"Erro ao obter informações do contato. Status: {response.status_code}, Resposta: {response.text}")
                return {
                    "success": False, 
                    "error": f"Erro HTTP {response.status_code}: {response.text}", 
                    "is_saved": False, 
                    "contact_name": ""
                }
                
        except Exception as e:
            logger.error(f"Exceção ao obter informações do contato: {str(e)}")
            return {"success": False, "error": str(e), "is_saved": False, "contact_name": ""}
    
    async def check_keyword_in_contact(self, phone_number: str, keyword: str) -> Dict[str, Any]:
        """
        Verifica se um contato tem uma palavra-chave específica no nome
        
        :param phone_number: Número de telefone no formato internacional
        :param keyword: Palavra-chave a ser verificada
        :return: Resultado da verificação
        """
        if not phone_number or not keyword:
            return {"success": False, "error": "Número de telefone e palavra-chave são obrigatórios"}
        
        # Verificar se está conectado
        if not self.connected:
            await self.connect()
        
        # Formatar o número (remover formatação e manter apenas dígitos)
        formatted_number = ''.join(filter(str.isdigit, phone_number))
        
        try:
            logger.info(f"Verificando palavra-chave '{keyword}' no contato {formatted_number}")
            
            response = requests.get(
                f"{self.service_url}/check-keyword/{formatted_number}",
                params={"keyword": keyword},
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"Verificação de palavra-chave concluída: {result}")
                return result
            else:
                logger.error(f"Erro ao verificar palavra-chave. Status: {response.status_code}, Resposta: {response.text}")
                return {
                    "success": False, 
                    "error": f"Erro HTTP {response.status_code}: {response.text}", 
                    "has_keyword": False
                }
                
        except Exception as e:
            logger.error(f"Exceção ao verificar palavra-chave: {str(e)}")
            return {"success": False, "error": str(e), "has_keyword": False}
    
    async def get_qr_code(self) -> Optional[str]:
        """
        Obtém o QR Code para autenticação do WhatsApp
        
        :return: URL do QR Code em base64 ou None se indisponível
        """
        try:
            response = requests.get(f"{self.service_url}/qr", timeout=5)
            if response.status_code == 200:
                data = response.json()
                return data.get("qr_code")
            return None
        except Exception as e:
            logger.error(f"Erro ao obter QR Code: {str(e)}")
            return None
    
    async def process_message(self, message: Dict[str, Any]):
        """
        Processa mensagens recebidas
        
        :param message: Dicionário com detalhes da mensagem
        """
        try:
            # Esta função será chamada pelo webhook quando mensagens forem recebidas
            sender = message.get('from')
            text = message.get('body', '').lower()
            
            logger.info(f"Processando mensagem de {sender}: {text}")
            
            # Lógica de processamento de diferentes tipos de mensagens
            if text == 'menu':
                await self.send_message(
                    sender, 
                    "Bem-vindo! Escolha uma opção:\n"
                    "1. Suporte\n"
                    "2. Produtos\n"
                    "3. Comprar"
                )
            elif text == 'produtos' or text == '2':
                await self.send_message(
                    sender, 
                    "Nossos Produtos:\n"
                    "A. Plano Básico\n"
                    "B. Plano Premium\n"
                    "C. Plano Enterprise"
                )
            # Implementar outras opções de processamento conforme necessário
            
        except Exception as e:
            logger.error(f"Erro ao processar mensagem: {str(e)}")
    
    async def disconnect(self) -> bool:
        """
        Desconecta do WhatsApp
        
        :return: True se desconectado com sucesso, False caso contrário
        """
        try:
            response = requests.post(f"{self.service_url}/logout", timeout=5)
            result = response.json()
            
            if result.get('success', False):
                self.connected = False
                # Cancelar o heartbeat se estiver rodando
                if self.heartbeat_task and not self.heartbeat_task.done():
                    self.heartbeat_task.cancel()
                    
                logger.info("Desconectado do WhatsApp com sucesso")
                return True
            else:
                logger.error(f"Falha ao desconectar: {result.get('message', 'Erro desconhecido')}")
                return False
        except Exception as e:
            logger.error(f"Erro ao desconectar do WhatsApp: {str(e)}")
            return False

# Função auxiliar para criar instância do bot
def create_whatsapp_bot(service_url: str = None) -> WhatsAppBot:
    """
    Cria uma instância do bot WhatsApp
    
    :param service_url: URL do serviço WhatsApp (opcional)
    :return: Instância do WhatsAppBot
    """
    return WhatsAppBot(service_url)