from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
import os
import shutil
import json
import asyncio
import time
import uuid
from database_models import get_db, User, Subscription, Product
from whatsapp_integration import create_whatsapp_bot

# Status do envio em massa (armazenado em memória)
MASS_MESSAGING_STATUS = {}

# Diretório para armazenar imagens temporárias
TEMP_IMAGE_DIR = "temp_images"
os.makedirs(TEMP_IMAGE_DIR, exist_ok=True)

# Rotas para envio de mensagens em massa
mass_messaging_router = APIRouter(prefix="/api/mass-messaging")

class MassMessageRequest(BaseModel):
    segment: str  # 'active', 'expired', 'all'
    message: str
    image_id: Optional[str] = None
    delay_seconds: int = 3  # Intervalo entre mensagens
    days_threshold: Optional[int] = None  # Para filtrar por dias até expiração


@mass_messaging_router.get("/segments")
async def get_user_segments(db: Session = Depends(get_db)):
    """
    Retorna estatísticas sobre os segmentos de usuários disponíveis
    """
    now = datetime.utcnow()
    
    # Contagem de usuários com assinaturas ativas
    active_count = db.query(User).join(Subscription).filter(
        Subscription.status == "active",
        Subscription.expiry_date > now
    ).distinct().count()
    
    # Contagem de usuários com assinaturas expiradas
    expired_count = db.query(User).join(Subscription).filter(
        Subscription.status == "expired"
    ).distinct().count()
    
    # Contagem de usuários com assinaturas prestes a expirar (próximos 7 dias)
    expiring_soon_count = db.query(User).join(Subscription).filter(
        Subscription.status == "active",
        Subscription.expiry_date > now,
        Subscription.expiry_date < now + timedelta(days=7)
    ).distinct().count()
    
    # Total de usuários
    total_users = db.query(User).count()
    
    return {
        "active": active_count,
        "expired": expired_count,
        "expiring_soon": expiring_soon_count,
        "total": total_users
    }


@mass_messaging_router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """
    Faz upload de uma imagem temporária para envio em massa
    """
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="O arquivo enviado não é uma imagem")
    
    # Gerar um ID único para a imagem
    image_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1]
    file_path = os.path.join(TEMP_IMAGE_DIR, f"{image_id}{file_extension}")
    
    # Salvar a imagem
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    return {
        "image_id": image_id,
        "file_name": file.filename,
        "file_path": file_path
    }


@mass_messaging_router.post("/send")
async def send_mass_message(
    background_tasks: BackgroundTasks,
    request: MassMessageRequest,
    db: Session = Depends(get_db)
):
    """
    Inicia o envio de mensagens em massa para um segmento específico
    """
    # Validar o segmento
    if request.segment not in ['active', 'expired', 'expiring_soon', 'all']:
        raise HTTPException(status_code=400, detail=f"Segmento inválido: {request.segment}")
    
    # Verificar se há uma imagem especificada e se ela existe
    image_path = None
    if request.image_id:
        # Procurar a imagem no diretório temporário
        for filename in os.listdir(TEMP_IMAGE_DIR):
            if filename.startswith(request.image_id):
                image_path = os.path.join(TEMP_IMAGE_DIR, filename)
                break
        
        if not image_path:
            raise HTTPException(status_code=404, detail=f"Imagem não encontrada: {request.image_id}")
    
    # Gerar um ID para este envio em massa
    task_id = str(uuid.uuid4())
    
    # Iniciar a tarefa em segundo plano
    background_tasks.add_task(
        process_mass_messaging,
        task_id,
        request.segment,
        request.message,
        image_path,
        request.delay_seconds,
        request.days_threshold,
        db
    )
    
    # Criar entrada para acompanhamento do status
    MASS_MESSAGING_STATUS[task_id] = {
        "status": "preparing",
        "started_at": datetime.utcnow().isoformat(),
        "segment": request.segment,
        "total_recipients": 0,
        "processed": 0,
        "successful": 0,
        "failed": 0,
        "last_updated": datetime.utcnow().isoformat(),
        "logs": []
    }
    
    return {
        "task_id": task_id,
        "message": "Envio de mensagens iniciado em segundo plano",
        "status_endpoint": f"/api/mass-messaging/status/{task_id}"
    }


@mass_messaging_router.get("/status/{task_id}")
async def get_message_status(task_id: str):
    """
    Retorna o status atual de um envio em massa
    """
    if task_id not in MASS_MESSAGING_STATUS:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    
    return MASS_MESSAGING_STATUS[task_id]


@mass_messaging_router.get("/history")
async def get_messaging_history():
    """
    Retorna o histórico de envios em massa
    """
    history = []
    
    for task_id, status in MASS_MESSAGING_STATUS.items():
        history.append({
            "task_id": task_id,
            "segment": status.get("segment"),
            "started_at": status.get("started_at"),
            "status": status.get("status"),
            "total_recipients": status.get("total_recipients"),
            "successful": status.get("successful"),
            "failed": status.get("failed")
        })
    
    # Ordenar do mais recente para o mais antigo
    history.sort(key=lambda x: x.get("started_at", ""), reverse=True)
    
    return history


async def process_mass_messaging(
    task_id: str,
    segment: str,
    message: str,
    image_path: str,
    delay_seconds: int,
    days_threshold: Optional[int],
    db: Session
):
    """
    Processa o envio de mensagens em massa em segundo plano
    """
    whatsapp_bot = create_whatsapp_bot()
    
    try:
        # Verificar se o WhatsApp está conectado
        is_connected = await whatsapp_bot.connect()
        if not is_connected:
            MASS_MESSAGING_STATUS[task_id]["status"] = "failed"
            MASS_MESSAGING_STATUS[task_id]["logs"].append(
                {"time": datetime.utcnow().isoformat(), "message": "WhatsApp não está conectado"}
            )
            return
        
        # Obter usuários com base no segmento selecionado
        now = datetime.utcnow()
        query = db.query(User).distinct()
        
        if segment == 'active':
            query = query.join(Subscription).filter(
                Subscription.status == "active",
                Subscription.expiry_date > now
            )
            
            # Se houver um limite de dias, aplicar filtro adicional
            if days_threshold is not None:
                query = query.filter(
                    Subscription.expiry_date <= now + timedelta(days=days_threshold)
                )
                
        elif segment == 'expired':
            query = query.join(Subscription).filter(
                Subscription.status == "expired"
            )
            
        elif segment == 'expiring_soon':
            query = query.join(Subscription).filter(
                Subscription.status == "active",
                Subscription.expiry_date > now,
                Subscription.expiry_date < now + timedelta(days=7)
            )
            
        # Para 'all', não aplicamos filtros adicionais, pois queremos todos os usuários
        
        # Obter usuários
        users = query.all()
        total_users = len(users)
        
        # Atualizar status
        MASS_MESSAGING_STATUS[task_id]["status"] = "in_progress"
        MASS_MESSAGING_STATUS[task_id]["total_recipients"] = total_users
        MASS_MESSAGING_STATUS[task_id]["logs"].append(
            {"time": datetime.utcnow().isoformat(), "message": f"Enviando para {total_users} usuários"}
        )
        
        # Dividir em lotes para evitar sobrecarga
        batch_size = 10
        for i in range(0, total_users, batch_size):
            user_batch = users[i:i+batch_size]
            
            # Enviar mensagens para o lote atual
            for user in user_batch:
                # Verificar se o usuário tem número de WhatsApp
                if not user.whatsapp_number:
                    MASS_MESSAGING_STATUS[task_id]["processed"] += 1
                    MASS_MESSAGING_STATUS[task_id]["failed"] += 1
                    MASS_MESSAGING_STATUS[task_id]["logs"].append(
                        {"time": datetime.utcnow().isoformat(), "message": f"Usuário {user.id} não tem número de WhatsApp"}
                    )
                    continue
                
                try:
                    # Preparar mensagem personalizada (substituir variáveis)
                    personalized_message = message
                    
                    # Substituir {nome} pelo nome do usuário
                    personalized_message = personalized_message.replace('{nome}', user.name or 'Cliente')
                    
                    # Buscar informações adicionais se necessário
                    subscription = db.query(Subscription).filter(
                        Subscription.user_id == user.id,
                        or_(
                            Subscription.status == "active",
                            Subscription.status == "expired"
                        )
                    ).order_by(Subscription.expiry_date.desc()).first()
                    
                    if subscription:
                        # Substituir {data_expiracao} pela data de expiração
                        if '{data_expiracao}' in personalized_message:
                            expiry_date = subscription.expiry_date.strftime("%d/%m/%Y")
                            personalized_message = personalized_message.replace('{data_expiracao}', expiry_date)
                        
                        # Substituir {dias_restantes} pelos dias restantes
                        if '{dias_restantes}' in personalized_message:
                            days_remaining = (subscription.expiry_date - now).days
                            personalized_message = personalized_message.replace('{dias_restantes}', str(max(0, days_remaining)))
                        
                        # Substituir {plano} pelo nome do produto
                        if '{plano}' in personalized_message:
                            product = db.query(Product).filter(Product.id == subscription.product_id).first()
                            product_name = product.name if product else 'Plano'
                            personalized_message = personalized_message.replace('{plano}', product_name)
                    
                    # Limitar tamanho da mensagem
                    if len(personalized_message) > 1000:
                        personalized_message = personalized_message[:997] + "..."
                        MASS_MESSAGING_STATUS[task_id]["logs"].append(
                            {"time": datetime.utcnow().isoformat(), "message": f"Mensagem para {user.whatsapp_number} foi truncada (muito longa)"}
                        )
                    
                    # Enviar mensagem
                    result = None
                    if image_path:
                        # Tentar enviar imagem com a mensagem
                        try:
                            # Primeiro enviar a imagem
                            image_result = await whatsapp_bot.send_image(user.whatsapp_number, image_path)
                            
                            # Depois enviar o texto
                            text_result = await whatsapp_bot.send_message(user.whatsapp_number, personalized_message)
                            
                            # Considerar sucesso se ambos forem bem-sucedidos
                            combined_success = image_result.get("success", False) and text_result.get("success", False)
                            log_message = f"Mensagem com imagem enviada para {user.whatsapp_number}"
                            
                            result = {
                                "success": combined_success,
                                "error": None if combined_success else "Falha ao enviar imagem ou texto"
                            }
                        except Exception as img_ex:
                            log_message = f"Erro ao enviar imagem para {user.whatsapp_number}: {str(img_ex)}"
                            result = {"success": False, "error": str(img_ex)}
                    else:
                        # Enviar apenas texto
                        result = await whatsapp_bot.send_message(user.whatsapp_number, personalized_message)
                        log_message = f"Mensagem enviada para {user.whatsapp_number}"
                    
                    # Atualizar contadores
                    MASS_MESSAGING_STATUS[task_id]["processed"] += 1
                    if result and result.get("success", False):
                        MASS_MESSAGING_STATUS[task_id]["successful"] += 1
                        MASS_MESSAGING_STATUS[task_id]["logs"].append(
                            {"time": datetime.utcnow().isoformat(), "message": log_message}
                        )
                    else:
                        MASS_MESSAGING_STATUS[task_id]["failed"] += 1
                        error = result.get("error", "Erro desconhecido") if result else "Erro desconhecido"
                        MASS_MESSAGING_STATUS[task_id]["logs"].append(
                            {"time": datetime.utcnow().isoformat(), "message": f"Erro ao enviar para {user.whatsapp_number}: {error}"}
                        )
                    
                    # Atualizar timestamp
                    MASS_MESSAGING_STATUS[task_id]["last_updated"] = datetime.utcnow().isoformat()
                    
                    # Aplicar delay entre mensagens individuais
                    if i < total_users - 1:  # Se não for o último usuário
                        await asyncio.sleep(delay_seconds)
                
                except Exception as e:
                    MASS_MESSAGING_STATUS[task_id]["processed"] += 1
                    MASS_MESSAGING_STATUS[task_id]["failed"] += 1
                    MASS_MESSAGING_STATUS[task_id]["logs"].append(
                        {"time": datetime.utcnow().isoformat(), "message": f"Exceção ao enviar para {user.whatsapp_number}: {str(e)}"}
                    )
            
            # Pausa entre lotes para evitar sobrecarga
            if i + batch_size < total_users:
                await asyncio.sleep(5)
                MASS_MESSAGING_STATUS[task_id]["logs"].append(
                    {"time": datetime.utcnow().isoformat(), "message": f"Pausa entre lotes - processados {i + len(user_batch)} de {total_users}"}
                )
        
        # Finalizar o processo
        MASS_MESSAGING_STATUS[task_id]["status"] = "completed"
        MASS_MESSAGING_STATUS[task_id]["logs"].append(
            {"time": datetime.utcnow().isoformat(), "message": "Envio de mensagens concluído"}
        )
    
    except Exception as e:
        MASS_MESSAGING_STATUS[task_id]["status"] = "failed"
        MASS_MESSAGING_STATUS[task_id]["logs"].append(
            {"time": datetime.utcnow().isoformat(), "message": f"Erro geral no processo: {str(e)}"}
        )
        
        import traceback
        trace = traceback.format_exc()
        MASS_MESSAGING_STATUS[task_id]["logs"].append(
            {"time": datetime.utcnow().isoformat(), "message": f"Stack trace: {trace}"}
        )