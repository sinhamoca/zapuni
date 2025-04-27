from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_  # Certifique-se que func está importado
from database_models import get_db, User, ChatbotFlow, ChatbotFlowStep, Transaction, RedeemCode, ChatbotFlowTrigger, UserConversationState, Product, SessionLocal, Subscription
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import json
import base64
import requests
import os
import time
import shutil
from datetime import datetime, timedelta

# Rotas para WhatsApp
whatsapp_router = APIRouter(prefix="/api/whatsapp")

# URL do serviço WhatsApp
WHATSAPP_SERVICE_URL = os.environ.get("WHATSAPP_SERVICE_URL", "http://whatsapp-service:8080")

# Variável global para armazenar o último status conhecido
LAST_KNOWN_STATUS = {
    "connected": False,
    "status": "disconnected",
    "last_check": 0,
    "phone": None
}

# Modelos de dados para validação
class WhatsAppStatusResponse(BaseModel):
    connected: bool
    qr_code: Optional[str] = None
    phone: Optional[str] = None
    status: str

class WhatsAppQRResponse(BaseModel):
    qr_code: str

class WhatsAppMessage(BaseModel):
    phone_number: str
    message: str
    metadata: Optional[dict] = None

class ResponseSettingsUpdate(BaseModel):
    respond_to_groups: bool
    respond_to_unsaved_contacts: bool
    respond_to_saved_contacts: bool
    respond_only_with_keyword: bool
    name_keyword: str = None
    active: bool
    
# SVG QR Code de fallback (caso o serviço não esteja disponível)
FALLBACK_QR_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect x="0" y="0" width="200" height="200" fill="white" />
  <path d="M0,0 h40 v40 h-40 z" fill="black"/>
  <path d="M80,0 h40 v40 h-40 z" fill="black"/>
  <path d="M160,0 h40 v40 h-40 z" fill="black"/>
  <path d="M0,40 h40 v40 h-40 z" fill="black"/>
  <path d="M160,40 h40 v40 h-40 z" fill="black"/>
  <path d="M0,80 h40 v40 h-40 z" fill="black"/>
  <path d="M80,80 h40 v40 h-40 z" fill="black"/>
  <path d="M160,80 h40 v40 h-40 z" fill="black"/>
  <path d="M0,160 h40 v40 h-40 z" fill="black"/>
  <path d="M80,160 h40 v40 h-40 z" fill="black"/>
  <path d="M160,160 h40 v40 h-40 z" fill="black"/>
</svg>"""

def get_fallback_qr_base64():
    """Converte o QR Code SVG para base64 com prefixo data:"""
    svg_bytes = FALLBACK_QR_SVG.encode('utf-8')
    base64_bytes = base64.b64encode(svg_bytes)
    base64_string = base64_bytes.decode('utf-8')
    return f"data:image/svg+xml;base64,{base64_string}"
@whatsapp_router.get("/response-settings")
async def get_response_settings(db: Session = Depends(get_db)):
    """
    Obtém as configurações de resposta do chatbot
    """
    from database_models import ResponseSettings
    
    # Buscar configurações existentes ou criar padrão
    settings = db.query(ResponseSettings).first()
    
    if not settings:
        # Criar configurações padrão se não existirem
        settings = ResponseSettings(
            respond_to_groups=True,
            respond_to_unsaved_contacts=True,
            respond_to_saved_contacts=True,
            respond_only_with_keyword=False,
            name_keyword="",
            active=True
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    return {
        "id": settings.id,
        "respond_to_groups": settings.respond_to_groups,
        "respond_to_unsaved_contacts": settings.respond_to_unsaved_contacts,
        "respond_to_saved_contacts": settings.respond_to_saved_contacts,
        "respond_only_with_keyword": settings.respond_only_with_keyword,
        "name_keyword": settings.name_keyword or "",
        "active": settings.active,
        "updated_at": settings.updated_at
    }

@whatsapp_router.post("/response-settings")
async def save_response_settings(settings_data: ResponseSettingsUpdate, db: Session = Depends(get_db)):
    """
    Salva as configurações de resposta do chatbot
    """
    from database_models import ResponseSettings
    
    # Buscar configurações existentes ou criar novas
    settings = db.query(ResponseSettings).first()
    
    if not settings:
        settings = ResponseSettings()
        db.add(settings)
    
    # Atualizar campos
    settings.respond_to_groups = settings_data.respond_to_groups
    settings.respond_to_unsaved_contacts = settings_data.respond_to_unsaved_contacts
    settings.respond_to_saved_contacts = settings_data.respond_to_saved_contacts
    settings.respond_only_with_keyword = settings_data.respond_only_with_keyword
    settings.name_keyword = settings_data.name_keyword
    settings.active = settings_data.active
    settings.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(settings)
    
    return {
        "success": True,
        "message": "Configurações de resposta salvas com sucesso",
        "settings": {
            "id": settings.id,
            "respond_to_groups": settings.respond_to_groups,
            "respond_to_unsaved_contacts": settings.respond_to_unsaved_contacts,
            "respond_to_saved_contacts": settings.respond_to_saved_contacts,
            "respond_only_with_keyword": settings.respond_only_with_keyword,
            "name_keyword": settings.name_keyword,
            "active": settings.active,
            "updated_at": settings.updated_at
        }
    }
# Funções para verificação de assinaturas
async def check_subscription_status(db: Session, phone_number: str):
    """
    Verifica se o usuário tem assinaturas e se estão ativas ou próximas ao vencimento
    Retorna um dicionário com informações sobre as assinaturas
    """
    # Normalizar o número de telefone
    normalized_number = ''.join(filter(str.isdigit, phone_number))
    
    # Buscar o usuário pelo número
    user = db.query(User).filter(User.whatsapp_number.like(f"%{normalized_number}%")).first()
    if not user:
        return {"has_subscription": False, "message": "Usuário não encontrado"}
    
    # Buscar assinaturas ativas do usuário
    now = datetime.utcnow()
    active_subscriptions = db.query(Subscription).filter(
        Subscription.user_id == user.id,
        Subscription.status == "active"
    ).all()
    
    if not active_subscriptions:
        # Buscar assinaturas expiradas recentemente (nos últimos 15 dias)
        recent_expired = db.query(Subscription).filter(
            Subscription.user_id == user.id,
            Subscription.status == "expired",
            Subscription.expiry_date >= now - timedelta(days=15)
        ).order_by(Subscription.expiry_date.desc()).first()
        
        if recent_expired:
            product = db.query(Product).filter(Product.id == recent_expired.product_id).first()
            product_name = product.name if product else "produto"
            
            return {
                "has_subscription": False,
                "has_expired": True,
                "days_since_expiry": (now - recent_expired.expiry_date).days,
                "subscription_id": recent_expired.id,
                "product_name": product_name,
                "message": f"Assinatura expirada há {(now - recent_expired.expiry_date).days} dias"
            }
        
        return {"has_subscription": False, "has_expired": False}
    
    # Pegar a assinatura que vai vencer mais próximo
    nearest_expiry = min(active_subscriptions, key=lambda s: s.expiry_date)
    product = db.query(Product).filter(Product.id == nearest_expiry.product_id).first()
    
    days_until_expiry = (nearest_expiry.expiry_date - now).days
    is_expiring_soon = days_until_expiry <= 5
    
    return {
        "has_subscription": True,
        "days_until_expiry": days_until_expiry,
        "is_expiring_soon": is_expiring_soon,
        "subscription_id": nearest_expiry.id,
        "product_name": product.name if product else "produto",
        "product_price": product.price if product else 0,
        "message": f"Assinatura válida, vence em {days_until_expiry} dias"
    }

# Função auxiliar para verificar se deve responder com base nas configurações
async def check_if_should_respond(db: Session, sender: str) -> bool:
    """
    Verifica se o chatbot deve responder a uma mensagem com base nas configurações
    
    :param db: Sessão do banco de dados
    :param sender: Número do remetente ou ID do grupo (ex: 5511999999999@c.us ou 5511999999999-1234567890@g.us)
    :return: True se deve responder, False caso contrário
    """
    from database_models import ResponseSettings
    
    # Buscar configurações de resposta
    settings = db.query(ResponseSettings).first()
    
    # Se não houver configurações ou estiver desativado, não responder
    if not settings or not settings.active:
        print(f"[DEBUG] Configurações não encontradas ou desativadas")
        return False
    
    # Verificar se é uma mensagem de grupo
    is_group = "@g.us" in sender
    if is_group and not settings.respond_to_groups:
        print(f"[DEBUG] Mensagem de grupo ignorada: {sender}")
        return False
    
    # Para mensagens individuais, verificar outras configurações
    if not is_group:
        # Determinar se o contato está salvo
        is_contact_saved = await check_if_contact_is_saved(sender)
        
        # Se não deve responder a contatos não salvos e o contato não está salvo
        if not settings.respond_to_unsaved_contacts and not is_contact_saved:
            print(f"[DEBUG] Contato não salvo ignorado: {sender}")
            return False
        
        # Se não deve responder a contatos salvos e o contato está salvo
        if not settings.respond_to_saved_contacts and is_contact_saved:
            print(f"[DEBUG] Contato salvo ignorado: {sender}")
            return False
        
        # Se deve responder apenas a contatos com palavra-chave no nome
        if settings.respond_only_with_keyword and is_contact_saved:
            # Buscar o nome do contato no WhatsApp (não no banco de dados)
            keyword = settings.name_keyword.lower() if settings.name_keyword else ""
            
            if keyword:
                # Verificar se o contato tem a palavra-chave no nome
                has_keyword = await check_if_contact_has_keyword(sender, keyword)
                
                if not has_keyword:
                    print(f"[DEBUG] Contato sem palavra-chave no nome ignorado: {sender}, palavra-chave={keyword}")
                    return False
    
    # Se passou por todas as verificações, responder
    return True

# Função auxiliar para verificar se um contato está salvo
# Esta agora usa a API real do WhatsApp
async def check_if_contact_is_saved(sender: str) -> bool:
    """
    Verifica se um contato está salvo na agenda do WhatsApp
    
    :param sender: Número do remetente (ex: 5511999999999@c.us)
    :return: True se o contato está salvo, False caso contrário
    """
    try:
        # Extrair o número do sender (remover @c.us, etc.)
        phone_number = sender.split('@')[0]
        
        # Fazer requisição ao serviço de WhatsApp para verificar contato
        response = requests.get(f"{WHATSAPP_SERVICE_URL}/contact-info/{phone_number}", timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            return data.get('is_saved', False)
        
        return False
    except Exception as e:
        print(f"Erro ao verificar se contato está salvo: {str(e)}")
        return False

# Função auxiliar para verificar se um contato tem palavra-chave no nome
async def check_if_contact_has_keyword(sender: str, keyword: str) -> bool:
    """
    Verifica se um contato tem uma palavra-chave específica no nome
    
    :param sender: Número do remetente (ex: 5511999999999@c.us)
    :param keyword: Palavra-chave a ser verificada
    :return: True se o nome do contato contém a palavra-chave, False caso contrário
    """
    try:
        # Extrair o número do sender (remover @c.us, etc.)
        phone_number = sender.split('@')[0]
        
        # Fazer requisição ao serviço de WhatsApp para verificar palavra-chave
        response = requests.get(
            f"{WHATSAPP_SERVICE_URL}/check-keyword/{phone_number}",
            params={"keyword": keyword},
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            return data.get('has_keyword', False)
        
        return False
    except Exception as e:
        print(f"Erro ao verificar palavra-chave no nome do contato: {str(e)}")
        return False

# Função auxiliar para obter o nome do contato
async def get_contact_name(sender: str) -> str:
    """
    Obtém o nome de um contato do WhatsApp
    
    :param sender: Número do remetente (ex: 5511999999999@c.us)
    :return: Nome do contato ou None se não estiver salvo
    """
    try:
        # Extrair o número do sender (remover @c.us, etc.)
        phone_number = sender.split('@')[0]
        
        # Fazer requisição ao serviço de WhatsApp para obter informações do contato
        response = requests.get(f"{WHATSAPP_SERVICE_URL}/contact-info/{phone_number}", timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success', False) and data.get('is_saved', False):
                return data.get('contact_name', '')
        
        # Se não conseguiu obter o nome do WhatsApp, tentar no banco de dados
        with SessionLocal() as local_db:
            user = local_db.query(User).filter(User.whatsapp_number.like(f"%{phone_number}%")).first()
            if user and user.name:
                return user.name
        
        # Se não encontrar em nenhum lugar, retornar um valor padrão
        return f"Contato {phone_number}"
    except Exception as e:
        print(f"Erro ao obter nome do contato: {str(e)}")
        return None
@whatsapp_router.get("/status")
async def get_whatsapp_status():
    """
    Retorna o status atual da conexão do WhatsApp
    """
    global LAST_KNOWN_STATUS
    
    current_time = time.time()
    # Verificar apenas a cada 20 segundos, exceto se estiver desconectado
    if current_time - LAST_KNOWN_STATUS["last_check"] < 20 and LAST_KNOWN_STATUS["connected"]:
        return WhatsAppStatusResponse(
            connected=LAST_KNOWN_STATUS["connected"],
            status=LAST_KNOWN_STATUS["status"],
            phone=LAST_KNOWN_STATUS["phone"]
        )
    
    try:
        response = requests.get(f"{WHATSAPP_SERVICE_URL}/status", timeout=5)
        data = response.json()
        
        # Adaptar para formato esperado pela interface
        status = data.get("status", "disconnected")
        connected = data.get("connected", False) or status == "connected" or status == "isLogged" or status == "authenticated"
        
        # Se o status mudou de desconectado para conectado, registrar
        if not LAST_KNOWN_STATUS["connected"] and connected:
            print(f"WhatsApp conectado em: {datetime.now().isoformat()}")
        
        # Atualizar o status conhecido
        LAST_KNOWN_STATUS = {
            "connected": connected,
            "status": status,
            "last_check": current_time,
            "phone": "5511999999999" if connected else None
        }
        
        return WhatsAppStatusResponse(
            connected=connected,
            status=status,
            phone=LAST_KNOWN_STATUS["phone"]
        )
    except Exception as e:
        print(f"Erro ao verificar status do WhatsApp: {str(e)}")
        
        # Se já estava conectado antes, manter o status
        if LAST_KNOWN_STATUS["connected"]:
            LAST_KNOWN_STATUS["last_check"] = current_time
            return WhatsAppStatusResponse(
                connected=True,
                status=LAST_KNOWN_STATUS["status"],
                phone=LAST_KNOWN_STATUS["phone"]
            )
        
        # Retornar fallback em caso de erro
        return WhatsAppStatusResponse(
            connected=False,
            status="error",
            phone=None
        )

@whatsapp_router.get("/contact-info/{phone}")
async def get_contact_info(phone: str):
    """
    Obtém informações de um contato do WhatsApp
    """
    try:
        # Verificar se o serviço do WhatsApp está acessível
        response = requests.get(f"{WHATSAPP_SERVICE_URL}/contact-info/{phone}", timeout=5)
        
        if response.status_code == 200:
            return response.json()
        else:
            return {
                "success": False,
                "error": f"Erro ao obter informações do contato: {response.status_code}",
                "is_saved": False,
                "contact_name": ""
            }
    except Exception as e:
        print(f"Erro ao obter informações do contato via API: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "is_saved": False,
            "contact_name": ""
        }
@whatsapp_router.post("/send-message")
async def send_whatsapp_message(message: WhatsAppMessage):
    """
    Envia uma mensagem para um número no WhatsApp
    """
    try:
        # Formatando o número de telefone
        phone_number = message.phone_number
        
        # Remover qualquer formatação do número (manter apenas dígitos)
        if not phone_number.endswith('@c.us') and not phone_number.endswith('@g.us'):
            phone_number = ''.join(filter(str.isdigit, phone_number))
        
        payload = {
            "jid": phone_number,
            "text": message.message
        }
        
        # Adicionar metadata se fornecido
        if message.metadata:
            payload["metadata"] = message.metadata
        
        print(f"Enviando mensagem para {phone_number}: {message.message[:50]}...")
        response = requests.post(f"{WHATSAPP_SERVICE_URL}/send", json=payload, timeout=15)
        
        if response.status_code != 200:
            print(f"Erro ao enviar mensagem: Status {response.status_code}")
            return {"success": False, "message": f"Erro HTTP {response.status_code}"}
            
        data = response.json()
        print(f"Resposta do envio: {data}")
        
        return data
    except Exception as e:
        print(f"Erro ao enviar mensagem WhatsApp: {str(e)}")
        return {"success": False, "message": f"Erro ao enviar mensagem: {str(e)}"}

@whatsapp_router.post("/send-image-message")
async def send_whatsapp_image_message(
    file: UploadFile = File(...),
    phone_number: str = Form(...),
    caption: Optional[str] = Form(None),
    metadata: Optional[str] = Form(None)
):
    """
    Envia uma imagem com legenda opcional para um número no WhatsApp
    """
    try:
        # Salvar o arquivo temporariamente
        temp_file_path = f"temp_image_{int(time.time())}.jpg"
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Formatando o número de telefone
        formatted_phone = phone_number
        
        # Remover qualquer formatação do número (manter apenas dígitos)
        if not formatted_phone.endswith('@c.us') and not formatted_phone.endswith('@g.us'):
            formatted_phone = ''.join(filter(str.isdigit, formatted_phone))
        
        # Adicionar metadata se fornecido
        metadata_dict = None
        if metadata:
            try:
                metadata_dict = json.loads(metadata)
            except:
                pass
        
        print(f"Enviando imagem para {formatted_phone} com legenda: {caption}")
        
        # Preparar dados do formulário para envio
        files = {
            'file': (file.filename, open(temp_file_path, 'rb'), file.content_type)
        }
        
        data = {
            'jid': formatted_phone,
        }
        
        if caption:
            data['caption'] = caption
        
        # Enviar a imagem para o serviço de WhatsApp
        response = requests.post(
            f"{WHATSAPP_SERVICE_URL}/send-image", 
            data=data,
            files=files,
            timeout=15
        )
        
        # Remover o arquivo temporário
        os.remove(temp_file_path)
        
        if response.status_code != 200:
            print(f"Erro ao enviar imagem: Status {response.status_code}")
            return {"success": False, "message": f"Erro HTTP {response.status_code}"}
            
        data = response.json()
        print(f"Resposta do envio de imagem: {data}")
        
        return data
    except Exception as e:
        print(f"Erro ao enviar imagem WhatsApp: {str(e)}")
        # Tentar limpar o arquivo temporário em caso de erro
        try:
            if 'temp_file_path' in locals() and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except:
            pass
        return {"success": False, "message": f"Erro ao enviar imagem: {str(e)}"}
@whatsapp_router.post("/generate-qr")
async def generate_qr_code():
    """
    Gera um QR Code para autenticação do WhatsApp
    """
    try:
        # Iniciar a conexão se ainda não estiver iniciada
        try:
            print("Solicitando inicialização da conexão WhatsApp")
            start_response = requests.get(f"{WHATSAPP_SERVICE_URL}/start", timeout=10)
            print(f"Resposta de inicialização: {start_response.status_code} - {start_response.text}")
        except Exception as e:
            print(f"Aviso ao iniciar WhatsApp: {str(e)}")
        
        # Aguardar um momento para o QR code ser gerado
        time.sleep(2)
        
        # Método 1: Obter o QR code como data URL
        try:
            print("Tentando obter QR code via API")
            response = requests.get(f"{WHATSAPP_SERVICE_URL}/qr", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                qr_code = data.get("qr_code", "")
                if qr_code:
                    print("QR code obtido com sucesso via API")
                    return {
                        "qr_code": qr_code,
                        "status": "success"
                    }
            print(f"API de QR code respondeu, mas sem dados: {response.status_code}")
        except Exception as e:
            print(f"Aviso ao obter QR code via API: {str(e)}")
        
        # Método 2: Obter o QR code diretamente como URL da imagem
        try:
            # Verificar se o endpoint de QR image está acessível
            print("Tentando acessar endpoint de imagem QR")
            test_response = requests.head(f"{WHATSAPP_SERVICE_URL}/qr-image", timeout=5)
            
            if test_response.status_code == 200:
                print("Endpoint de imagem QR está acessível")
                image_url = f"{WHATSAPP_SERVICE_URL}/qr-image?t={int(time.time())}"
                return {
                    "qr_code": image_url,
                    "status": "image_url",
                    "direct_url": True
                }
            else:
                print(f"Endpoint de imagem QR não está acessível: {test_response.status_code}")
        except Exception as e:
            print(f"Aviso ao verificar endpoint de imagem QR: {str(e)}")
        
        # Método 3: Tentar forçar a geração de um QR code de teste
        try:
            print("Solicitando geração de QR code de teste")
            response = requests.get(f"{WHATSAPP_SERVICE_URL}/generate-test-qr", timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                qr_code = data.get("qr_code", "")
                if qr_code:
                    print("QR code de teste gerado com sucesso")
                    return {
                        "qr_code": qr_code,
                        "status": "test"
                    }
            print(f"Endpoint de QR teste respondeu, mas sem QR útil: {response.status_code}")
        except Exception as e:
            print(f"Aviso ao gerar QR code de teste: {str(e)}")
        
        # Método 4: Último recurso, retornar a URL direta para a imagem
        print("Retornando URL direta da imagem como último recurso")
        return {
            "qr_code": f"{WHATSAPP_SERVICE_URL}/qr-image?t={int(time.time())}",
            "status": "direct_url",
            "is_fallback": True
        }
    
    except Exception as e:
        print(f"Erro ao gerar QR Code: {str(e)}")
        # Retornar QR code de fallback em caso de erro
        return {
            "qr_code": get_fallback_qr_base64(),
            "status": "error"
        }

@whatsapp_router.post("/disconnect")
async def disconnect_whatsapp():
    """
    Desconecta do WhatsApp
    """
    global LAST_KNOWN_STATUS
    
    try:
        response = requests.post(f"{WHATSAPP_SERVICE_URL}/logout", timeout=10)
        data = response.json()
        
        # Atualizar status para desconectado
        LAST_KNOWN_STATUS["connected"] = False
        LAST_KNOWN_STATUS["status"] = "disconnected"
        LAST_KNOWN_STATUS["phone"] = None
        LAST_KNOWN_STATUS["last_check"] = time.time()
        
        return data
    except Exception as e:
        print(f"Erro ao desconectar do WhatsApp: {str(e)}")
        return {"success": False, "message": f"Erro ao desconectar: {str(e)}"}

@whatsapp_router.post("/reload-session")
async def reload_whatsapp_session():
    """
    Recarrega a sessão do WhatsApp
    """
    try:
        # Reiniciar a conexão
        response = requests.get(f"{WHATSAPP_SERVICE_URL}/start", timeout=10)
        data = response.json()
        
        # Após recarregar, forçar verificação do status
        global LAST_KNOWN_STATUS
        LAST_KNOWN_STATUS["last_check"] = 0
        
        return data
    except Exception as e:
        print(f"Erro ao recarregar sessão do WhatsApp: {str(e)}")
        return {"success": False, "message": f"Erro ao recarregar sessão: {str(e)}"}
@whatsapp_router.post("/webhook")
async def whatsapp_webhook(data: dict, db: Session = Depends(get_db)):
    """
    Recebe mensagens do serviço de WhatsApp via webhook
    """
    try:
        print(f"[WEBHOOK] Recebido: {data}")
        print(f"[WEBHOOK] DADOS: Tipo={data.get('type')}, De={data.get('message', {}).get('from')}, Texto={data.get('message', {}).get('body')}")
        
        if data.get('type') == 'message':
            message = data.get('message', {})
            sender = message.get('from')
            text = message.get('body', '')
            
            # Ignorar mensagens vazias
            if not text or not sender:
                print("[DEBUG] Mensagem vazia ignorada")
                return {"success": True, "message": "Mensagem vazia ignorada"}
            
            # Verificar configurações de resposta
            should_respond = await check_if_should_respond(db, sender)
            if not should_respond:
                print(f"[DEBUG] Não respondendo à mensagem de {sender} devido às configurações")
                return {"success": True, "message": "Mensagem ignorada devido às configurações"}
            
            # Continuar com o processamento normal...
            print(f"[DEBUG] Processando mensagem: '{text}' de '{sender}'")
            
            # Verificar se é um código de resgate (formato padrão: letras e números, 8 caracteres)
            import re
            if re.match(r'^[A-Za-z0-9]{8}$', text.strip()):
                # Tentar processar como código de resgate
                print(f"[DEBUG] Processando '{text}' como código de resgate")
                await verify_redeem_code(db, text, sender)
                return {"success": True, "message": "Código de resgate processado"}
            
            # Buscar ou criar usuário
            user = await get_or_create_user(db, sender)
            print(f"[DEBUG] Usuário encontrado/criado: ID={user.id}")
            
            # Processar mensagem de acordo com o estado da conversa
            result = await process_user_input(db, user.id, text, sender)
            print(f"[DEBUG] Resultado do processamento da mensagem: {result}")
            
            # Se o usuário acabou de fazer uma compra (confirmada via webhook), verificar seu status de assinatura
            if 'compra' in text.lower() or 'assinatura' in text.lower() or 'plano' in text.lower():
                subscription_info = await check_subscription_status(db, sender)
                print(f"[DEBUG] Informações da assinatura: {subscription_info}")
            
            return {"success": True, "message": "Mensagem processada com sucesso"}
        
        return {"success": True, "message": "Webhook recebido"}
    except Exception as e:
        print(f"Erro ao processar webhook do WhatsApp: {str(e)}")
        import traceback
        traceback.print_exc()  # Imprime o stack trace completo
        return {"success": False, "message": f"Erro ao processar webhook: {str(e)}"}
@whatsapp_router.get("/debug")
async def debug_whatsapp():
    """
    Endpoint de diagnóstico para o WhatsApp
    """
    try:
        # Verificar status do serviço
        service_status = {"available": False, "error": None}
        try:
            status_response = requests.get(f"{WHATSAPP_SERVICE_URL}/status", timeout=3)
            service_status = {
                "available": True,
                "status_code": status_response.status_code,
                "status": status_response.json() if status_response.status_code == 200 else None
            }
        except Exception as e:
            service_status["error"] = str(e)
        
        # Verificar QR code
        qr_status = {"available": False, "error": None}
        try:
            qr_response = requests.head(f"{WHATSAPP_SERVICE_URL}/qr-image", timeout=3)
            qr_status = {
                "available": qr_response.status_code == 200,
                "status_code": qr_response.status_code
            }
        except Exception as e:
            qr_status["error"] = str(e)
        
        # Obter informações de debug do serviço
        debug_info = {"available": False, "error": None}
        try:
            debug_response = requests.get(f"{WHATSAPP_SERVICE_URL}/debug", timeout=3)
            debug_info = {
                "available": debug_response.status_code == 200,
                "status_code": debug_response.status_code,
                "info": debug_response.json() if debug_response.status_code == 200 else None
            }
        except Exception as e:
            debug_info["error"] = str(e)
        
        # Adicionar informações do cache de status
        global LAST_KNOWN_STATUS
        status_cache_info = {
            "connected": LAST_KNOWN_STATUS["connected"],
            "status": LAST_KNOWN_STATUS["status"],
            "last_check": LAST_KNOWN_STATUS["last_check"],
            "age_seconds": time.time() - LAST_KNOWN_STATUS["last_check"],
            "phone": LAST_KNOWN_STATUS["phone"]
        }
        
        # Testar a funcionalidade de verificação de contatos
        contact_test = {"available": False, "error": None}
        try:
            test_number = "5511999999999"  # Número de teste
            contact_response = requests.get(f"{WHATSAPP_SERVICE_URL}/contact-info/{test_number}", timeout=3)
            contact_test = {
                "available": contact_response.status_code == 200,
                "status_code": contact_response.status_code,
                "info": contact_response.json() if contact_response.status_code == 200 else None
            }
        except Exception as e:
            contact_test["error"] = str(e)
        
        return {
            "service_url": WHATSAPP_SERVICE_URL,
            "service_status": service_status,
            "qr_status": qr_status,
            "debug_info": debug_info,
            "status_cache": status_cache_info,
            "contact_test": contact_test,
            "timestamp": time.time()
        }
    except Exception as e:
        return {"error": str(e)}

# Adicione também um endpoint para verificar assinaturas próximas do vencimento
# Este endpoint pode ser chamado por um cron job
@whatsapp_router.get("/check-expiring-subscriptions")
async def check_expiring_subscriptions(days: int = 3, db: Session = Depends(get_db)):
    """
    Verifica assinaturas que vão expirar em X dias
    """
    # Calcular intervalo de datas para assinaturas que vencem em X dias
    now = datetime.utcnow()
    target_date = now + timedelta(days=days)
    
    # Buscar assinaturas que vencem no intervalo
    expiring_soon = db.query(Subscription).filter(
        Subscription.status == "active",
        Subscription.auto_renew == True,
        Subscription.expiry_date >= datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0),
        Subscription.expiry_date < datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59)
    ).all()
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "count": len(expiring_soon),
        "subscriptions": [
            {
                "id": sub.id,
                "user_id": sub.user_id,
                "product_id": sub.product_id,
                "expiry_date": sub.expiry_date.isoformat()
            }
            for sub in expiring_soon
        ]
    }

# Função auxiliar para buscar ou criar usuário
async def get_or_create_user(db: Session, whatsapp_number: str) -> User:
    """
    Busca um usuário pelo número do WhatsApp ou cria se não existir
    """
    # Remover formatação do número
    whatsapp_number = ''.join(filter(str.isdigit, whatsapp_number))
    
    user = db.query(User).filter(User.whatsapp_number == whatsapp_number).first()
    
    if not user:
        user = User(
            whatsapp_number=whatsapp_number,
            registered_at=datetime.utcnow()
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    return user

# Função para atualizar/criar assinatura de usuário
# Função modificada para evitar duplicação de clientes e somar períodos
async def update_user_subscription(db: Session, user_id: int, product_id: int, whatsapp_number: str = None, days: int = 30):
    """
    Atualiza a assinatura de um usuário ou cria uma nova
    
    :param db: Sessão do banco de dados
    :param user_id: ID do usuário
    :param product_id: ID do produto
    :param whatsapp_number: Número do WhatsApp para buscar usuário existente (opcional)
    :param days: Número de dias para adicionar à data de expiração
    :return: A assinatura atualizada ou criada
    """
    # Se fornecido um número de WhatsApp, verificar se o usuário já existe
    if whatsapp_number:
        # Normalizar o número (remover @c.us e manter apenas dígitos)
        if '@' in whatsapp_number:
            normalized_number = whatsapp_number.split('@')[0]
        else:
            normalized_number = whatsapp_number
        normalized_number = ''.join(filter(str.isdigit, normalized_number))
        
        existing_user = db.query(User).filter(
            User.whatsapp_number.like(f"%{normalized_number}%")
        ).first()
        
        if existing_user:
            print(f"[DEBUG] Usuário existente encontrado pelo WhatsApp {normalized_number}: ID={existing_user.id}")
            user_id = existing_user.id
    
    # Verificar se o usuário já tem uma assinatura ativa para este produto
    now = datetime.utcnow()
    subscription = db.query(Subscription).filter(
        Subscription.user_id == user_id,
        Subscription.product_id == product_id,
        Subscription.status.in_(["active", "expired"])
    ).first()
    
    if subscription:
        # Determinar a nova data de expiração
        if subscription.status == "active" and subscription.expiry_date > now:
            # Se ainda está ativa, adiciona dias à data de expiração atual
            new_expiry = subscription.expiry_date + timedelta(days=days)
        else:
            # Se expirada ou prestes a expirar, adiciona dias à data atual
            new_expiry = now + timedelta(days=days)
        
        # Atualizar assinatura
        subscription.expiry_date = new_expiry
        subscription.status = "active"
        subscription.updated_at = now
    else:
        # Criar nova assinatura
        subscription = Subscription(
            user_id=user_id,
            product_id=product_id,
            start_date=now,
            expiry_date=now + timedelta(days=days),
            status="active",
            auto_renew=True
        )
        db.add(subscription)
    
    db.commit()
    db.refresh(subscription)
    return subscription

# Função para enviar mensagem usando o serviço de WhatsApp
async def send_message_to_user(recipient: str, message: str):
    """
    Envia mensagem para um usuário usando o serviço de WhatsApp
    """
    try:
        # Formatar número
        if not recipient.endswith('@c.us') and not recipient.endswith('@g.us'):
            recipient = ''.join(filter(str.isdigit, recipient))
        
        payload = {
            "jid": recipient,
            "text": message
        }
        
        print(f"[DEBUG] Enviando mensagem para {recipient}: {message[:50]}...")
        response = requests.post(f"{WHATSAPP_SERVICE_URL}/send", json=payload, timeout=15)
        
        if response.status_code != 200:
            print(f"Erro ao enviar mensagem: Status {response.status_code}")
            return False
            
        return True
    except Exception as e:
        print(f"Erro ao enviar mensagem WhatsApp: {str(e)}")
        return False
# Função para obter o estado atual da conversa de um usuário
async def get_conversation_state(db: Session, user_id: int):
    """
    Obtém o estado atual da conversa de um usuário
    """
    from database_models import UserConversationState
    
    # Buscar estado atual
    state = db.query(UserConversationState).filter(
        UserConversationState.user_id == user_id
    ).first()
    
    # Se não existir, criar um novo estado vazio
    if not state:
        state = UserConversationState(
            user_id=user_id,
            current_flow_id=None,
            current_step_id=None,
            data="{}"
        )
        db.add(state)
        db.commit()
        db.refresh(state)
    
    return state

# Função para atualizar o estado da conversa de um usuário
async def update_conversation_state(db: Session, user_id: int, flow_id=None, step_id=None, data=None):
    """
    Atualiza o estado da conversa de um usuário
    
    :param user_id: ID do usuário
    :param flow_id: ID do fluxo atual (ou None para limpar)
    :param step_id: ID do passo atual (ou None para limpar)
    :param data: Dados do estado em formato dict (opcional)
    """
    from database_models import UserConversationState
    
    # Buscar estado atual ou criar um novo
    state = await get_conversation_state(db, user_id)
    
    # Atualizar os campos necessários
    if flow_id is not None:  # Permitir ser 0, que seria um ID válido
        state.current_flow_id = flow_id
    
    if step_id is not None:  # Permitir ser 0, que seria um ID válido
        state.current_step_id = step_id
    
    if data is not None:
        # Converter dict para JSON se for um dict
        if isinstance(data, dict):
            state.data = json.dumps(data)
        else:
            state.data = data
    
    # Atualizar timestamp
    state.last_message_timestamp = datetime.utcnow()
    
    # Salvar no banco de dados
    db.commit()
    
    return state

async def show_available_products(db: Session, sender: str, user_id: int, step_data=None):
    """
    Função helper para mostrar produtos disponíveis e opções de compra
    """
    # Buscar produtos ativos do banco de dados
    products = db.query(Product).filter(Product.active == True).all()
    
    if not products:
        await send_message_to_user(sender, "Desculpe, não há produtos disponíveis no momento.")
        return False
    
    # Construir mensagem com lista de produtos
    message = "🛍️ *PRODUTOS DISPONÍVEIS* 🛍️\n\n"
    
    for i, product in enumerate(products, 1):
        price_formatted = f"R$ {product.price:.2f}".replace('.', ',')
        message += f"{i}. *{product.name}*\n"
        message += f"   Descrição: {product.description}\n"
        message += f"   Preço: *{price_formatted}*\n\n"
    
    message += "\nPara comprar, envie o *número* do produto desejado. Para sair, digite *Cancelar*."
    
    # Salvar os produtos disponíveis no estado da conversa para referência futura
    product_data = {
        "available_products": {str(p.id): {"name": p.name, "price": p.price} for p in products}
    }
    
    # Se tivermos dados adicionais, incluí-los
    if step_data:
        product_data.update(step_data)
    
    # Atualizar o estado com os produtos disponíveis
    await update_conversation_state(db, user_id, data=product_data)
    
    # Enviar mensagem
    await send_message_to_user(sender, message)
    return True

# Função principal para processar a entrada do usuário
async def process_user_input(db: Session, user_id: int, text: str, sender: str):
    """
    Processa a entrada do usuário baseada no estado atual da conversa
    """
    from database_models import ChatbotFlowStep, UserConversationState, Product
    
    # Obter estado atual
    state = await get_conversation_state(db, user_id)
    print(f"[DEBUG] Estado atual do usuário {user_id}: flow_id={state.current_flow_id}, step_id={state.current_step_id}")
    print(f"[DEBUG] Dados do estado: {state.data}")
    print(f"[DEBUG] Mensagem recebida do usuário: '{text}'")

    # Se a mensagem for "cancelar" ou "sair", sempre encerrar o fluxo
    if text.lower() in ['cancelar', 'sair']:
        print(f"[DEBUG] Usuário solicitou cancelar/sair. Encerrando fluxo.")
        await update_conversation_state(db, user_id, None, None)
        await send_message_to_user(
            sender, 
            "Atendimento encerrado. Se precisar de ajuda novamente, é só me chamar!"
        )
        return True
    
    # Se a mensagem for "status" ou "minha assinatura", mostrar status da assinatura
    if text.lower() in ['status', 'minha assinatura', 'assinatura']:
        subscription_info = await check_subscription_status(db, sender)
        
        if subscription_info["has_subscription"]:
            # Usuário tem assinatura ativa
            message = (
                f"*Status da sua assinatura:*\n\n"
                f"✅ *Plano:* {subscription_info['product_name']}\n"
                f"📅 *Vencimento:* em {subscription_info['days_until_expiry']} dias\n\n"
            )
            
            if subscription_info["is_expiring_soon"]:
                message += (
                    "⚠️ *Atenção:* Sua assinatura vencerá em breve!\n"
                    "Para renovar, basta enviar a palavra *COMPRAR* a qualquer momento."
                )
            else:
                message += "Sua assinatura está ativa e em dia. Obrigado pela preferência!"
                
            await send_message_to_user(sender, message)
            return True
            
        elif subscription_info.get("has_expired"):
            # Assinatura expirada recentemente
            message = (
                f"*Status da sua assinatura:*\n\n"
                f"❌ *Plano:* {subscription_info['product_name']}\n"
                f"⚠️ *Status:* Expirado há {subscription_info['days_since_expiry']} dias\n\n"
                f"Para renovar sua assinatura, envie a palavra *COMPRAR* a qualquer momento."
            )
            await send_message_to_user(sender, message)
            return True
            
        else:
            # Não tem assinatura
            message = (
                "*Status da sua assinatura:*\n\n"
                "❌ Você não possui assinaturas ativas no momento.\n\n"
                "Para adquirir uma assinatura, envie a palavra *COMPRAR* a qualquer momento."
            )
            await send_message_to_user(sender, message)
            return True
# Se não estiver em nenhum fluxo, verificar por palavras-chave
    if state.current_flow_id is None or state.current_step_id is None:
        # Buscar fluxo através de palavras-chave
        print(f"[DEBUG] Usuário {user_id} não está em nenhum fluxo. Buscando fluxo para mensagem: '{text}'")
        return await find_and_start_flow(db, user_id, text, sender)
    
    # Se estiver em um fluxo, processar resposta do usuário
    current_step = db.query(ChatbotFlowStep).filter(
        ChatbotFlowStep.id == state.current_step_id
    ).first()
    
    if not current_step:
        # Passo não encontrado, reiniciar
        print(f"[DEBUG] Passo {state.current_step_id} não encontrado, reiniciando")
        await update_conversation_state(db, user_id, None, None)
        return await find_and_start_flow(db, user_id, text, sender)
    
    print(f"[DEBUG] Processando passo atual: flow_id={current_step.flow_id}, step_id={current_step.id}, ordem={current_step.step_order}, tipo={current_step.action_type}")
    
    # Verificar se a resposta era esperada
    if current_step.expected_responses:
        expected_list = [r.strip().lower() for r in current_step.expected_responses.split(',')]
        print(f"[DEBUG] Respostas esperadas: {expected_list}")
        print(f"[DEBUG] Resposta recebida: '{text.lower()}'")
        
        if text.lower() not in expected_list and expected_list and '*' not in expected_list:
            # Resposta não esperada, enviar mensagem de erro
            try:
                message = f"Desculpe, não entendi sua resposta. Por favor, responda com uma das opções: {current_step.expected_responses}"
                print(f"[DEBUG] Resposta não esperada. Enviando mensagem de erro: {message}")
                await send_message_to_user(sender, message)
                return True
            except Exception as e:
                print(f"Erro ao enviar mensagem de erro: {e}")
                return False

    # Lógica específica para cada tipo de ação
    if current_step.action_type == 'show_products':
        # Se estamos mostrando produtos e o usuário está respondendo com um número
        state_data = json.loads(state.data) if state.data else {}
        print(f"[DEBUG] Estado dos produtos: {state_data.get('available_products', 'Nenhum')}")
        print(f"[DEBUG] Produto selecionado: {state_data.get('selected_product_id', 'Nenhum')}")
        
        # Verificar se o usuário está selecionando um produto por número
        if text.isdigit() and 'available_products' in state_data:
            product_number = int(text)
            available_products = state_data.get('available_products', {})
            
            # Obter todos os produtos do banco de dados
            products = db.query(Product).filter(Product.active == True).all()
            
            if 0 < product_number <= len(products):
                selected_product = products[product_number-1]  # Ajustar para índice 0-based
                
                # Verificar se o usuário tem assinatura ativa do produto selecionado
                subscription_info = await check_subscription_status(db, sender)
                renewal_message = ""
                
                if subscription_info.get("has_subscription") and subscription_info.get("product_name") == selected_product.name:
                    renewal_message = f"\n\n📅 Você já possui uma assinatura ativa deste produto válida por mais {subscription_info['days_until_expiry']} dias. Ao renovar agora, você estenderá o período da sua assinatura atual."
                
                # Mostrar confirmação e opção de pagamento
                await send_message_to_user(
                    sender,
                    f"Você selecionou: *{selected_product.name}*\n"
                    f"Preço: R$ {selected_product.price:.2f}{renewal_message}\n\n"
                    f"Para gerar o link de pagamento:\n\n"
                    f"Para gerar, digite *CONFIRMAR*\n"
                    f"Para cancelar, digite *CANCELAR*."
                )
                
                # Atualizar estado com o produto selecionado
                state_data['selected_product_id'] = selected_product.id
                state_data['selected_product_name'] = selected_product.name
                state_data['selected_product_price'] = float(selected_product.price)
                
                # Criar nova etapa de seleção
                await update_conversation_state(db, user_id, data=state_data)
                return True
            else:
                await send_message_to_user(
                    sender,
                    "Número de produto inválido. Por favor, escolha um número da lista."
                )
                # Re-exibir a lista de produtos
                await show_available_products(db, sender, user_id, state_data)
                return True
        elif text.lower() == 'confirmar' and 'selected_product_id' in state_data:
            # Usuário confirmou a compra, gerar link de pagamento
            from payment_integration import create_payment_handler
            
            product_id = state_data.get('selected_product_id')
            product_name = state_data.get('selected_product_name')
            
            payment_handler = create_payment_handler()
            
            # Enviar mensagem de espera
            await send_message_to_user(sender, "Gerando link de pagamento. Aguarde um momento...")
            
            try:
                # Gerar pagamento PIX
                formatted_number = ''.join(filter(str.isdigit, sender))
                if "@" in sender:
                    formatted_number = formatted_number.split("@")[0]
                
                print(f"[DEBUG] Gerando pagamento PIX para produto {product_id}, usuário {user_id}, valor {state_data.get('selected_product_price')}")
                payment_info = payment_handler.create_pix_payment(
                    amount=state_data.get('selected_product_price'),
                    product_name=product_name,
                    user_id=user_id,
                    product_id=product_id,
                    email=f"{formatted_number}@whatsapp.com"
                )
                
                print(f"[DEBUG] Informações de pagamento geradas: {payment_info}")
                
                if payment_info and "qr_code" in payment_info:
                    # Salvamos o ID da transação no estado para consulta posterior
                    state_data['transaction_id'] = payment_info['transaction_id']
                    state_data['payment_id'] = payment_info['payment_id']
                    state_data['payment_pending'] = True
                    await update_conversation_state(db, user_id, data=state_data)
                    
                    print(f"[DEBUG] Estado atualizado com transaction_id={payment_info['transaction_id']}, payment_id={payment_info['payment_id']}")
                    
                    # Enviar informações do produto e instruções
                    await send_message_to_user(
                        sender,
                        f"*PAGAMENTO PIX GERADO*\n\n"
                        f"Produto: {product_name}\n"
                        f"Valor: R$ {state_data.get('selected_product_price'):.2f}\n\n"
                        f"📋Copie o código que enviarei em seguida\n"
                        f"📱Abra o aplicativo do seu banco\n"
                        f"💸Entre na opção 'PIX Copia e Cola' e cole o código\n"
                        f"✅ O valor será processado manualmente!\n\n"
                        f"Para receber seu código após o pagamento, basta enviar a palavra *VERIFICAR* ✉️\n\n"
                        f"Copie o codigo a baixo 👇👇👇\n"
                    )
                    
                    # Enviar o código PIX separadamente
                    await send_message_to_user(
                        sender,
                        f"{payment_info['qr_code']}"
                    )
                    
                    return True
                else:
                    # Erro ao gerar pagamento
                    print(f"[DEBUG] Erro ao gerar pagamento: informações incompletas {payment_info}")
                    await send_message_to_user(
                        sender,
                        "Desculpe, não foi possível gerar o pagamento no momento. "
                        "Por favor, tente novamente mais tarde."
                    )
                    return False
            except Exception as e:
                print(f"[DEBUG] Exceção ao gerar pagamento: {e}")
                await send_message_to_user(
                    sender,
                    "Desculpe, ocorreu um erro ao gerar o pagamento. "
                    "Por favor, tente novamente mais tarde."
                )
                return False
        elif text.lower() == 'verificar' and state_data.get('payment_pending') and state_data.get('transaction_id'):
            # Verificar status do pagamento
            from payment_integration import create_payment_handler
            
            payment_handler = create_payment_handler()
            transaction_id = state_data.get('transaction_id')
            payment_id = state_data.get('payment_id')
            
            print(f"[DEBUG] Iniciando verificação de pagamento. transaction_id={transaction_id}, payment_id={payment_id}")
            
            # Buscar transação no banco de dados - USANDO NOVA SESSÃO
            try:
                # Criar uma nova sessão especificamente para esta operação
                with SessionLocal() as new_db:
                    print(f"[DEBUG] Buscando transação {transaction_id} no banco de dados")
                    transaction = new_db.query(Transaction).filter(Transaction.id == transaction_id).first()
                    if not transaction:
                        print(f"[DEBUG] Transação {transaction_id} não encontrada no banco de dados")
                        await send_message_to_user(
                            sender, 
                            "Desculpe, não foi possível encontrar sua transação. "
                            "Por favor, entre em contato com nosso suporte."
                        )
                        return False
                    
                    print(f"[DEBUG] Transação encontrada: {transaction.id}, status={transaction.status}, payment_method_id={transaction.payment_method_id}")
                    
                    # Verificar pagamento no Mercado Pago
                    payment_method_id = transaction.payment_method_id
                    
                    if payment_method_id:
                        print(f"[DEBUG] Verificando pagamento no Mercado Pago: {payment_method_id}")
                        payment_status = payment_handler.verify_payment(payment_method_id)
                        print(f"[DEBUG] Resposta da verificação: {payment_status}")
                        
                        if payment_status.get('is_approved'):
                            print(f"[DEBUG] Pagamento aprovado! Gerando código de resgate")
                            # Pagamento aprovado, gerar código de resgate
                            redeem_code = payment_handler.generate_redeem_code(transaction_id)
                            print(f"[DEBUG] Código de resgate gerado: {redeem_code}")
                            
                            # Atualizar/criar assinatura
                            subscription = await update_user_subscription(
                                new_db,
                                user_id,
                                transaction.product_id
                            )
                            # Adicionar informações da assinatura à mensagem
                            subscription_info = ""
                            if subscription:
                                expiry_date = subscription.expiry_date.strftime("%d/%m/%Y")
                                subscription_info = f"\n\nSua assinatura foi ativada e é válida até *{expiry_date}*."
                            
                            await send_message_to_user(
                                sender,
                                f"✅ *PAGAMENTO APROVADO!* ✅\n\n"
                                f"Seu código de acesso é: *{redeem_code}*{subscription_info}\n\n"
                                f"Guarde este código com cuidado. Ele é a chave para acessar seu produto.\n"
                                f"Para suporte, entre em contato conosco a qualquer momento."
                            )
                            
                            # Limpar estado da conversa
                            await update_conversation_state(db, user_id, None, None)
                            return True
                        else:
                            # Pagamento ainda pendente
                            print(f"[DEBUG] Pagamento ainda pendente. Status: {payment_status.get('status')}")
                            await send_message_to_user(
                                sender,
                                f"⏳ *PAGAMENTO PENDENTE* ⏳\n\n"
                                f"Seu pagamento ainda não foi confirmado. "
                                f"Isso pode levar alguns minutos após o pagamento.\n\n"
                                f"Digite *VERIFICAR* novamente para checar o status."
                            )
                            return True
                    else:
                        print(f"[DEBUG] Transação sem payment_method_id, impossível verificar")
                        await send_message_to_user(
                            sender, 
                            "Desculpe, não foi possível verificar seu pagamento. "
                            "Por favor, entre em contato com nosso suporte."
                        )
                        return False

            except Exception as e:
                print(f"[DEBUG] Erro ao verificar pagamento: Tipo: {type(e).__name__}, Mensagem: {str(e)}")
                import traceback
                traceback.print_exc()
                await send_message_to_user(
                    sender,
                    "Desculpe, ocorreu um erro ao verificar seu pagamento. "
                    "Por favor, tente novamente em alguns instantes."
                )
                return False
        else:
            # Re-exibir os produtos disponíveis
            await show_available_products(db, sender, user_id, state_data)
            return True
# Processar a resposta conforme o tipo de ação do passo atual
    if current_step.action_type == 'collect_input':
        # Salvar a resposta do usuário
        data = json.loads(state.data) if state.data else {}
        data[f"step_{current_step.step_order}"] = text
        await update_conversation_state(db, user_id, data=data)
        print(f"[DEBUG] Coletada entrada '{text}' para passo {current_step.step_order}")
    
    # Avançar para o próximo passo
    next_step = db.query(ChatbotFlowStep).filter(
        ChatbotFlowStep.flow_id == current_step.flow_id,
        ChatbotFlowStep.step_order == current_step.step_order + 1
    ).first()
    
    print(f"[DEBUG] Próximo passo encontrado: {next_step is not None}")
    
    if next_step:
        # Próximo passo no mesmo fluxo
        print(f"[DEBUG] Avançando para próximo passo: {next_step.step_order} (ID: {next_step.id})")
        await update_conversation_state(db, user_id, step_id=next_step.id)
        
        # Enviar mensagem do próximo passo
        try:
            message = next_step.message_template
            # Substituir variáveis no template
            if state.data:
                data = json.loads(state.data)
                for key, value in data.items():
                    message = message.replace("{" + key + "}", str(value))
            
            print(f"[DEBUG] Enviando mensagem do próximo passo: {message[:50]}...")
            await send_message_to_user(sender, message)
            return True
        except Exception as e:
            print(f"Erro ao enviar próximo passo: {e}")
            return False

    elif current_step.next_flow_id:
        # Próximo fluxo
        print(f"[DEBUG] Passando para o próximo fluxo: {current_step.next_flow_id}")
        return await start_flow(db, user_id, current_step.next_flow_id, sender)
    else:
        # Não há próximo passo ou fluxo, mas não necessariamente devemos encerrar
        # Verificar o tipo de ação do passo atual para decidir se encerramos ou não
        if current_step.action_type in ['message', 'collect_input', 'show_products']:
            # Para esses tipos de ação, continuamos no mesmo passo esperando entrada do usuário
            print(f"[DEBUG] Mantendo o fluxo atual (tipo={current_step.action_type}) para esperar mais interações")
            
            # Processar a ação específica do tipo atual
            if current_step.action_type == 'show_products':
                # Se for mostrar produtos, vamos mostrar os produtos disponíveis
                print(f"[DEBUG] Ação show_products identificada, mostrando produtos disponíveis")
                state_data = json.loads(state.data) if state.data else {}
                await show_available_products(db, sender, user_id, state_data)
                return True
            else:
                # Para outros tipos, enviar uma mensagem de continuação
                message = "Deseja mais alguma informação? Responda com uma nova pergunta ou digite 'Sair' para encerrar."
                await send_message_to_user(sender, message)
                return True
        else:
            # Para outros tipos de ação, podemos encerrar o fluxo
            print(f"[DEBUG] Fim do fluxo detectado. Motivo: Nenhum próximo passo ou fluxo encontrado.")
            print(f"[DEBUG] Estado antes de encerrar: flow_id={current_step.flow_id}, step_id={current_step.id}")
            await update_conversation_state(db, user_id, None, None)
            try:
                message = "Obrigado por sua interação! Se precisar de algo mais, é só me avisar."
                print(f"[DEBUG] Enviando mensagem de encerramento para {sender}")
                await send_message_to_user(sender, message)
                return True
            except Exception as e:
                print(f"Erro ao enviar mensagem de encerramento: {e}")
                return False

# Função para encontrar e iniciar um fluxo baseado em palavras-chave
async def find_and_start_flow(db: Session, user_id: int, text: str, sender: str):
    """
    Encontra e inicia um fluxo baseado em palavras-chave na mensagem
    """
    from database_models import ChatbotFlowTrigger, ChatbotFlow
    
    text_lower = text.lower()
    print(f"[DEBUG] Procurando gatilhos para o texto: '{text_lower}'")
    
    # Listar todos os gatilhos disponíveis para diagnóstico
    all_available_triggers = db.query(ChatbotFlowTrigger).join(ChatbotFlow).filter(
        ChatbotFlow.active == True
    ).all()
    print(f"[DEBUG] Gatilhos disponíveis no sistema: {len(all_available_triggers)}")
    for t in all_available_triggers:
        print(f"[DEBUG] Gatilho disponível: '{t.keyword}', flow_id={t.flow_id}, exato={t.is_exact_match}")
    
    # Primeiro, buscar correspondências exatas com maior prioridade
    triggers = db.query(ChatbotFlowTrigger).join(ChatbotFlow).filter(
        ChatbotFlow.active == True,
        ChatbotFlowTrigger.is_exact_match == True,
        func.lower(ChatbotFlowTrigger.keyword) == text_lower  # Usando func.lower
    ).order_by(ChatbotFlowTrigger.priority.desc()).all()
    
    print(f"[DEBUG] Encontrados {len(triggers)} gatilhos com correspondência exata")
    
    # Se não encontrar correspondência exata, buscar correspondências parciais
    if not triggers:
        all_triggers = db.query(ChatbotFlowTrigger).join(ChatbotFlow).filter(
            ChatbotFlow.active == True,
            ChatbotFlowTrigger.is_exact_match == False
        ).order_by(ChatbotFlowTrigger.priority.desc()).all()
        
        # Filtrar para encontrar palavras-chave contidas no texto
        triggers = []
        for t in all_triggers:
            # Converter a keyword para minúsculas para comparação
            keyword_lower = t.keyword.lower()
            if keyword_lower in text_lower:
                triggers.append(t)
        
        print(f"[DEBUG] Encontrados {len(triggers)} gatilhos com correspondência parcial")
    
    # Depuração para listar todos os gatilhos encontrados
    for trigger in triggers:
        print(f"[DEBUG] Gatilho encontrado: '{trigger.keyword}', fluxo_id={trigger.flow_id}, exato={trigger.is_exact_match}, prioridade={trigger.priority}")
    
    # Se encontrou algum gatilho, iniciar o fluxo correspondente
    if triggers:
        trigger = triggers[0]  # Pegar o de maior prioridade
        print(f"[DEBUG] Iniciando fluxo {trigger.flow_id} com gatilho '{trigger.keyword}'")
        return await start_flow(db, user_id, trigger.flow_id, sender)
    
    # Se não encontrou gatilho, enviar mensagem padrão
    try:
        message = """Seja ao UniTvendas para prosseguir digite alguma palavara: 
    
    📲 *COMPRAR* - Ver produtos disponíveis
    ℹ️ *SUPORTE* - Falar com atendente
    
    🆘 *Lembrete*: _Ao comprar qualquer pacote voce recebe seu produto AUTOMATICAMENTE apos o pagamento!_"""
        print(f"[DEBUG] Nenhum gatilho encontrado. Enviando mensagem padrão: {message}")
        await send_message_to_user(sender, message)
        return True
    except Exception as e:
        print(f"Erro ao enviar mensagem padrão: {e}")
        return False
# Função para iniciar um fluxo específico
async def start_flow(db: Session, user_id: int, flow_id: int, sender: str):
    """
    Inicia um fluxo específico
    """
    from database_models import ChatbotFlow, ChatbotFlowStep, ChatbotFlowTrigger
    
    print(f"[DEBUG] Tentando iniciar fluxo {flow_id} para usuário {user_id}")
    
    flow = db.query(ChatbotFlow).filter(
        ChatbotFlow.id == flow_id,
        ChatbotFlow.active == True
    ).first()
    
    if not flow:
        print(f"[DEBUG] Fluxo {flow_id} não encontrado ou inativo")
        return False
    
    # Buscar o primeiro passo do fluxo
    first_step = db.query(ChatbotFlowStep).filter(
        ChatbotFlowStep.flow_id == flow_id,
        ChatbotFlowStep.step_order == 1
    ).first()
    
    if not first_step:
        print(f"[DEBUG] Primeiro passo do fluxo {flow_id} não encontrado")
        return False
    
    # Se este é o fluxo de renovação e o usuário tem assinatura, buscar informações
    if flow.name == 'Renovação de Assinatura':
        # Verificar assinatura do usuário
        subscription_info = await check_subscription_status(db, sender)
        data = {"flow_started": True}
        
        if subscription_info["has_subscription"]:
            # Adicionar os dados da assinatura ao estado
            data.update({
                "product_name": subscription_info["product_name"],
                "product_price": subscription_info.get("product_price", 0),
                "days_until_expiry": subscription_info["days_until_expiry"],
                "subscription_id": subscription_info["subscription_id"]
            })
    else:
        data = {"flow_started": True}
    
    # Atualizar o estado da conversa
    await update_conversation_state(
        db, 
        user_id, 
        flow_id=flow_id, 
        step_id=first_step.id,
        data=data
    )
    
    # Verificar se é um tipo especial que precisa de processamento adicional
    if first_step.action_type == 'show_products':
        print(f"[DEBUG] Primeiro passo é show_products, mostrando produtos disponíveis")
        await show_available_products(db, sender, user_id)
        return True
    
    # Enviar a mensagem do primeiro passo, substituindo variáveis se possível
    try:
        message = first_step.message_template
        
        # Substituir variáveis no template se tivermos dados
        if data and len(data) > 1:  # Se tiver mais que apenas flow_started
            for key, value in data.items():
                message = message.replace("{" + key + "}", str(value))
        
        print(f"[DEBUG] Enviando primeira mensagem do fluxo: {message[:50]}...")
        await send_message_to_user(sender, message)
        return True
    except Exception as e:
        print(f"Erro ao iniciar fluxo: {e}")
        return False

# Verificar código de resgate
async def verify_redeem_code(db: Session, code: str, sender: str):
    """
    Verifica se um código de resgate é válido e o processa
    """
    from database_models import RedeemCode, Transaction, Product
    from payment_integration import create_payment_handler
    
    print(f"[DEBUG] Verificando código de resgate: {code} para {sender}")
    
    # Normalizar código (remover espaços e deixar maiúsculo)
    code = code.strip().upper()
    
    # Verificar se o código existe e está disponível
    redeem_code = db.query(RedeemCode).filter(
        RedeemCode.code == code,
        RedeemCode.status == "available"
    ).first()
    
    if not redeem_code:
        print(f"[DEBUG] Código {code} inválido ou já utilizado")
        try:
            await send_message_to_user(
                sender, 
                "Código de resgate inválido ou já utilizado. Por favor, verifique e tente novamente."
            )
        except Exception as e:
            print(f"Erro ao enviar mensagem de código inválido: {e}")
        return False
    
    # Obter a transação e produto associados
    transaction = db.query(Transaction).filter(
        Transaction.id == redeem_code.transaction_id
    ).first()
    
    if not transaction:
        print(f"[DEBUG] Transação não encontrada para código {code}")
        try:
            await send_message_to_user(
                sender, 
                "Erro ao processar o código. Transação não encontrada."
            )
        except Exception as e:
            print(f"Erro ao enviar mensagem de transação não encontrada: {e}")
        return False
    
    product = db.query(Product).filter(
        Product.id == transaction.product_id
    ).first()
    
    # Marcar o código como utilizado
    redeem_code.status = "expired"
    redeem_code.used_at = datetime.utcnow()
    
    # Registrar ou atualizar o usuário
    user = await get_or_create_user(db, sender)
    
    # Vincular a transação ao usuário se ainda não estiver vinculada
    if not transaction.user_id:
        transaction.user_id = user.id
    
    # Atualizar/criar assinatura para o usuário
    subscription = await update_user_subscription(
        db, 
        user.id,
        transaction.product_id
    )
    
    db.commit()
    
    print(f"[DEBUG] Código {code} resgatado com sucesso para usuário {user.id}")
    
    # Enviar confirmação ao usuário
    try:
        product_name = product.name if product else "Produto"
        
        # Adicionar informações da assinatura se disponível
        subscription_info = ""
        if subscription:
            expiry_date = subscription.expiry_date.strftime("%d/%m/%Y")
            subscription_info = f"\n\nSua assinatura foi ativada e é válida até *{expiry_date}*."
        
        await send_message_to_user(
            sender, 
            f"✅ *Código resgatado com sucesso!* ✅\n\n"
            f"Seu *{product_name}* foi ativado.{subscription_info}\n\n"
            f"Agradecemos a preferência! Para qualquer dúvida, estamos à disposição."
        )
        
        return True
    except Exception as e:
        print(f"Erro ao enviar confirmação de resgate: {e}")
        return False
# Webhook para receber notificações do Mercado Pago
@whatsapp_router.post("/mercadopago-webhook")
async def mercadopago_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Recebe notificações de pagamento do Mercado Pago
    """
    try:
        body = await request.json()
        print(f"[WEBHOOK] Recebido do Mercado Pago: {body}")
        
        # Verificar tipo de notificação
        action = body.get('action')
        if action == 'payment.updated' or action == 'payment.created':
            data = body.get('data', {})
            payment_id = data.get('id')
            
            if payment_id:
                # Verificar pagamento no sistema
                result = await process_payment_update(payment_id, db)
                
                # Se o pagamento foi aprovado e tem transação associada
                if result and result.get('transaction_id'):
                    transaction_id = result.get('transaction_id')
                    
                    # Buscar a transação
                    transaction = db.query(Transaction).filter(
                        Transaction.id == transaction_id
                    ).first()
                    
                    if transaction and transaction.user_id and transaction.product_id:
                        # Atualizar/criar assinatura
                        subscription = await update_user_subscription(
                            db, 
                            transaction.user_id,
                            transaction.product_id
                        )
                        
                        print(f"[DEBUG] Assinatura atualizada/criada: {subscription.id}")
                
                return {"success": True, "message": "Notificação processada"}
        
        return {"success": True, "message": "Notificação recebida"}
    except Exception as e:
        print(f"Erro ao processar webhook do Mercado Pago: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": f"Erro ao processar webhook: {str(e)}"}

# Processar atualização de pagamento (usada pelo webhook)
async def process_payment_update(payment_id: str, db: Session):
    """
    Processa atualização de pagamento recebida via webhook
    """
    from payment_integration import create_payment_handler
    
    try:
        payment_handler = create_payment_handler()
        
        # Verificar o status do pagamento
        payment_status = payment_handler.verify_payment(payment_id)
        
        if not payment_status.get('is_approved'):
            print(f"[DEBUG] Pagamento {payment_id} não aprovado: {payment_status.get('status')}")
            return False
        
        # Se o pagamento foi aprovado, buscar a transação
        transaction = db.query(Transaction).filter(
            Transaction.payment_method_id == str(payment_id)
        ).first()
        
        if not transaction:
            print(f"[DEBUG] Transação não encontrada para pagamento {payment_id}")
            return False
        
        # Atualizar status da transação
        transaction.status = "paid"
        db.commit()
        
        # Gerar código de resgate
        redeem_code = payment_handler.generate_redeem_code(transaction.id)
        
        # Buscar usuário para notificar
        if transaction.user_id:
            user = db.query(User).filter(User.id == transaction.user_id).first()
            
            if user and user.whatsapp_number:
                # Buscar produto comprado
                product = db.query(Product).filter(Product.id == transaction.product_id).first()
                product_name = product.name if product else "Produto"
                
                # Verificar se deve atualizar/criar assinatura - passando também o número de whatsapp
                subscription = await update_user_subscription(
                    db, 
                    transaction.user_id,
                    transaction.product_id,
                    user.whatsapp_number
                )
                
                # Construir mensagem com informações da assinatura
                expiry_message = ""
                if subscription:
                    expiry_date = subscription.expiry_date.strftime("%d/%m/%Y")
                    expiry_message = f"\n\nSua assinatura é válida até: *{expiry_date}*"
                
                # Enviar notificação ao usuário
                await send_message_to_user(
                    user.whatsapp_number,
                    f"✅ *PAGAMENTO APROVADO!* ✅\n\n"
                    f"Seu pagamento para *{product_name}* foi confirmado!\n\n"
                    f"Seu código de acesso é: *{redeem_code}*{expiry_message}\n\n"
                    f"Guarde este código com cuidado. Ele é a chave para acessar seu produto.\n"
                    f"Para suporte, entre em contato conosco a qualquer momento."
                )
                
                # Limpar estado da conversa do usuário
                state = db.query(UserConversationState).filter(
                    UserConversationState.user_id == transaction.user_id
                ).first()
                
                if state:
                    state.current_flow_id = None
                    state.current_step_id = None
                    db.commit()
                
                print(f"[DEBUG] Notificação de pagamento enviada para usuário {user.whatsapp_number}")
        
        return {
            "success": True, 
            "transaction_id": transaction.id
        }
    except Exception as e:
        print(f"Erro ao processar atualização de pagamento: {e}")
        return False


# Adicione também um endpoint para verificar assinaturas próximas do vencimento
# Este endpoint pode ser chamado por um cron job
@whatsapp_router.get("/check-expiring-subscriptions")
async def check_expiring_subscriptions(days: int = 3, db: Session = Depends(get_db)):
    """
    Verifica assinaturas que vão expirar em X dias
    """
    # Calcular intervalo de datas para assinaturas que vencem em X dias
    now = datetime.utcnow()
    target_date = now + timedelta(days=days)
    
    # Buscar assinaturas que vencem no intervalo
    expiring_soon = db.query(Subscription).filter(
        Subscription.status == "active",
        Subscription.auto_renew == True,
        Subscription.expiry_date >= datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0),
        Subscription.expiry_date < datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59)
    ).all()
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "count": len(expiring_soon),
        "subscriptions": [
            {
                "id": sub.id,
                "user_id": sub.user_id,
                "product_id": sub.product_id,
                "expiry_date": sub.expiry_date.isoformat()
            }
            for sub in expiring_soon
        ]
    }



