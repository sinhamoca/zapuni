from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database_models import get_db, Subscription, User, Product
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

# Rotas para gerenciamento de assinaturas
subscription_router = APIRouter(prefix="/api/subscriptions")

# Modelos de dados para validação
class SubscriptionCreate(BaseModel):
    user_id: int
    product_id: int
    start_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: str = "active"
    auto_renew: bool = True

class SubscriptionUpdate(BaseModel):
    product_id: Optional[int] = None
    expiry_date: Optional[datetime] = None
    status: Optional[str] = None
    auto_renew: Optional[bool] = None

class SubscriptionResponse(BaseModel):
    id: int
    user_id: int
    product_id: int
    start_date: datetime
    expiry_date: datetime
    status: str
    auto_renew: bool
    last_reminder_sent: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    # Incluir informações do usuário e produto
    user_name: Optional[str] = None
    user_whatsapp: Optional[str] = None
    product_name: Optional[str] = None
    product_price: Optional[float] = None

@subscription_router.post("/", response_model=SubscriptionResponse)
def create_subscription(subscription: SubscriptionCreate, db: Session = Depends(get_db)):
    """
    Cria uma nova assinatura
    """
    # Verificar se o usuário existe
    user = db.query(User).filter(User.id == subscription.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    # Verificar se o produto existe
    product = db.query(Product).filter(Product.id == subscription.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    # Definir datas padrão se não forem fornecidas
    start_date = subscription.start_date or datetime.utcnow()
    # Por padrão, a expiração é 30 dias após o início
    expiry_date = subscription.expiry_date or (start_date + timedelta(days=30))
    
    # Criar nova assinatura
    new_subscription = Subscription(
        user_id=subscription.user_id,
        product_id=subscription.product_id,
        start_date=start_date,
        expiry_date=expiry_date,
        status=subscription.status,
        auto_renew=subscription.auto_renew
    )
    
    db.add(new_subscription)
    db.commit()
    db.refresh(new_subscription)
    
    # Montar resposta com informações adicionais
    response = {
        **new_subscription.__dict__,
        "user_name": user.name,
        "user_whatsapp": user.whatsapp_number,
        "product_name": product.name,
        "product_price": product.price
    }
    
    return response

@subscription_router.get("/", response_model=List[SubscriptionResponse])
def list_subscriptions(
    status: Optional[str] = None,
    expired: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    Lista todas as assinaturas com opção de filtrar por status
    """
    query = db.query(Subscription)
    
    # Filtrar por status se fornecido
    if status:
        query = query.filter(Subscription.status == status)
    
    # Filtrar por expiração
    if expired is not None:
        now = datetime.utcnow()
        if expired:
            # Mostrar apenas expiradas
            query = query.filter(Subscription.expiry_date < now)
        else:
            # Mostrar apenas não expiradas
            query = query.filter(Subscription.expiry_date >= now)
    
    subscriptions = query.all()
    
    # Adicionar informações de usuário e produto para cada assinatura
    results = []
    for sub in subscriptions:
        user = db.query(User).filter(User.id == sub.user_id).first()
        product = db.query(Product).filter(Product.id == sub.product_id).first()
        
        sub_dict = {**sub.__dict__}
        if user:
            sub_dict["user_name"] = user.name
            sub_dict["user_whatsapp"] = user.whatsapp_number
        else:
            sub_dict["user_name"] = None
            sub_dict["user_whatsapp"] = None
            
        if product:
            sub_dict["product_name"] = product.name
            sub_dict["product_price"] = product.price
        else:
            sub_dict["product_name"] = None
            sub_dict["product_price"] = None
        
        results.append(sub_dict)
    
    return results

@subscription_router.get("/{subscription_id}", response_model=SubscriptionResponse)
def get_subscription(subscription_id: int, db: Session = Depends(get_db)):
    """
    Obtém detalhes de uma assinatura específica
    """
    subscription = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not subscription:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    
    # Adicionar informações de usuário e produto
    user = db.query(User).filter(User.id == subscription.user_id).first()
    product = db.query(Product).filter(Product.id == subscription.product_id).first()
    
    response = {**subscription.__dict__}
    if user:
        response["user_name"] = user.name
        response["user_whatsapp"] = user.whatsapp_number
    else:
        response["user_name"] = None
        response["user_whatsapp"] = None
        
    if product:
        response["product_name"] = product.name
        response["product_price"] = product.price
    else:
        response["product_name"] = None
        response["product_price"] = None
    
    return response

@subscription_router.get("/user/{user_id}", response_model=List[SubscriptionResponse])
def get_user_subscriptions(user_id: int, db: Session = Depends(get_db)):
    """
    Obtém todas as assinaturas de um usuário específico
    """
    subscriptions = db.query(Subscription).filter(Subscription.user_id == user_id).all()
    
    # Adicionar informações de produto para cada assinatura
    results = []
    user = db.query(User).filter(User.id == user_id).first()
    
    for sub in subscriptions:
        product = db.query(Product).filter(Product.id == sub.product_id).first()
        
        sub_dict = {**sub.__dict__}
        if user:
            sub_dict["user_name"] = user.name
            sub_dict["user_whatsapp"] = user.whatsapp_number
        else:
            sub_dict["user_name"] = None
            sub_dict["user_whatsapp"] = None
            
        if product:
            sub_dict["product_name"] = product.name
            sub_dict["product_price"] = product.price
        else:
            sub_dict["product_name"] = None
            sub_dict["product_price"] = None
        
        results.append(sub_dict)
    
    return results

@subscription_router.get("/whatsapp/{phone_number}", response_model=List[SubscriptionResponse])
def get_subscription_by_whatsapp(phone_number: str, db: Session = Depends(get_db)):
    """
    Busca assinaturas por número de WhatsApp
    """
    # Normalizar o número de telefone (remover formatação)
    normalized_number = ''.join(filter(str.isdigit, phone_number))
    
    # Buscar o usuário pelo número
    user = db.query(User).filter(User.whatsapp_number.like(f"%{normalized_number}%")).first()
    if not user:
        return []
    
    # Buscar assinaturas do usuário
    subscriptions = db.query(Subscription).filter(Subscription.user_id == user.id).all()
    
    # Adicionar informações de produto para cada assinatura
    results = []
    for sub in subscriptions:
        product = db.query(Product).filter(Product.id == sub.product_id).first()
        
        sub_dict = {**sub.__dict__}
        sub_dict["user_name"] = user.name
        sub_dict["user_whatsapp"] = user.whatsapp_number
            
        if product:
            sub_dict["product_name"] = product.name
            sub_dict["product_price"] = product.price
        else:
            sub_dict["product_name"] = None
            sub_dict["product_price"] = None
        
        results.append(sub_dict)
    
    return results

@subscription_router.put("/{subscription_id}", response_model=SubscriptionResponse)
def update_subscription(subscription_id: int, subscription: SubscriptionUpdate, db: Session = Depends(get_db)):
    """
    Atualiza uma assinatura existente
    """
    db_subscription = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not db_subscription:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    
    # Atualizar campos se fornecidos
    if subscription.product_id is not None:
        # Verificar se o produto existe
        product = db.query(Product).filter(Product.id == subscription.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Produto não encontrado")
        db_subscription.product_id = subscription.product_id
    
    if subscription.expiry_date is not None:
        db_subscription.expiry_date = subscription.expiry_date
    
    if subscription.status is not None:
        db_subscription.status = subscription.status
    
    if subscription.auto_renew is not None:
        db_subscription.auto_renew = subscription.auto_renew
    
    db_subscription.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_subscription)
    
    # Adicionar informações de usuário e produto
    user = db.query(User).filter(User.id == db_subscription.user_id).first()
    product = db.query(Product).filter(Product.id == db_subscription.product_id).first()
    
    response = {**db_subscription.__dict__}
    if user:
        response["user_name"] = user.name
        response["user_whatsapp"] = user.whatsapp_number
    else:
        response["user_name"] = None
        response["user_whatsapp"] = None
        
    if product:
        response["product_name"] = product.name
        response["product_price"] = product.price
    else:
        response["product_name"] = None
        response["product_price"] = None
    
    return response

@subscription_router.post("/{subscription_id}/renew", response_model=SubscriptionResponse)
def renew_subscription(subscription_id: int, days: int = 30, db: Session = Depends(get_db)):
    """
    Renova uma assinatura por um número específico de dias
    """
    db_subscription = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not db_subscription:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    
    # Calcular nova data de expiração
    new_expiry = datetime.utcnow() + timedelta(days=days)
    
    # Se a assinatura atual ainda não venceu, adicionar dias à data atual
    if db_subscription.expiry_date > datetime.utcnow():
        new_expiry = db_subscription.expiry_date + timedelta(days=days)
    
    # Atualizar assinatura
    db_subscription.expiry_date = new_expiry
    db_subscription.status = "active"
    db_subscription.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_subscription)
    
    # Adicionar informações de usuário e produto
    user = db.query(User).filter(User.id == db_subscription.user_id).first()
    product = db.query(Product).filter(Product.id == db_subscription.product_id).first()
    
    response = {**db_subscription.__dict__}
    if user:
        response["user_name"] = user.name
        response["user_whatsapp"] = user.whatsapp_number
    else:
        response["user_name"] = None
        response["user_whatsapp"] = None
        
    if product:
        response["product_name"] = product.name
        response["product_price"] = product.price
    else:
        response["product_name"] = None
        response["product_price"] = None
    
    return response

@subscription_router.delete("/{subscription_id}")
def delete_subscription(subscription_id: int, db: Session = Depends(get_db)):
    """
    Cancela uma assinatura (define o status como canceled)
    """
    db_subscription = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not db_subscription:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    
    # Marcar como cancelada
    db_subscription.status = "canceled"
    db_subscription.updated_at = datetime.utcnow()
    
    db.commit()
    
    return {"message": "Assinatura cancelada com sucesso"}

@subscription_router.get("/expiring/today")
def get_expiring_today(db: Session = Depends(get_db)):
    """
    Obtém assinaturas que vencem hoje
    """
    today = datetime.utcnow().date()
    
    # Buscar assinaturas que vencem hoje e estão ativas
    expiring = db.query(Subscription).filter(
        Subscription.status == "active",
        Subscription.expiry_date >= datetime(today.year, today.month, today.day, 0, 0, 0),
        Subscription.expiry_date < datetime(today.year, today.month, today.day, 23, 59, 59)
    ).all()
    
    return {"count": len(expiring), "subscriptions": expiring}

@subscription_router.post("/send-reminders")
async def send_reminders(db: Session = Depends(get_db)):
    """
    Envia lembretes para assinaturas que vencem hoje
    """
    from whatsapp_integration import create_whatsapp_bot
    
    # Criar instância do bot
    whatsapp_bot = create_whatsapp_bot()
    
    # Verificar se o WhatsApp está conectado
    is_connected = await whatsapp_bot.connect()
    if not is_connected:
        raise HTTPException(status_code=503, detail="Serviço de WhatsApp não está conectado")
    
    today = datetime.utcnow().date()
    
    # Buscar assinaturas que vencem hoje
    expiring = db.query(Subscription).filter(
        Subscription.status == "active",
        Subscription.expiry_date >= datetime(today.year, today.month, today.day, 0, 0, 0),
        Subscription.expiry_date < datetime(today.year, today.month, today.day, 23, 59, 59)
    ).all()
    
    sent_count = 0
    failed_count = 0
    
    for subscription in expiring:
        # Buscar usuário e produto
        user = db.query(User).filter(User.id == subscription.user_id).first()
        product = db.query(Product).filter(Product.id == subscription.product_id).first()
        
        if not user or not user.whatsapp_number:
            failed_count += 1
            continue
        
        # Preparar mensagem
        product_name = product.name if product else "seu plano"
        message = (
            f"Olá {user.name or ''}! Seu plano *{product_name}* vence hoje. "
            f"Para renovar, basta enviar a palavra *COMPRAR* e seguir as instruções. "
            f"Ao renovar hoje, você evita a interrupção do serviço. Obrigado pela preferência!"
        )
        
        # Enviar mensagem
        try:
            result = await whatsapp_bot.send_message(
                phone_number=user.whatsapp_number,
                message=message
            )
            
            if result and result.get("success"):
                # Atualizar timestamp do último lembrete
                subscription.last_reminder_sent = datetime.utcnow()
                db.commit()
                sent_count += 1
            else:
                failed_count += 1
        except Exception:
            failed_count += 1
    
    return {
        "success": True,
        "total": len(expiring),
        "sent": sent_count,
        "failed": failed_count
    }
