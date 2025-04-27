#!/usr/bin/env python
"""
Script para verificar assinaturas que estão prestes a vencer e enviar lembretes.
Este script pode ser configurado para ser executado diariamente como uma tarefa cron.

Exemplo de configuração cron:
0 9 * * * /caminho/para/python /caminho/para/subscription_scheduler.py
"""

import asyncio
import sys
import logging
import os
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("subscription_scheduler.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("subscription_scheduler")

# Importar models e serviços necessários
try:
    # Adicionar o diretório do projeto ao path
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from database_models import get_db, Subscription, User, Product
    from whatsapp_integration import create_whatsapp_bot
except ImportError as e:
    logger.error(f"Erro ao importar módulos: {e}")
    sys.exit(1)

async def send_reminder(whatsapp_bot, user, product, subscription, days_left):
    """
    Envia um lembrete de vencimento para o usuário
    """
    # Verificar se o WhatsApp está conectado
    is_connected = await whatsapp_bot.connect()
    if not is_connected:
        logger.error("Serviço de WhatsApp não está conectado")
        return False
    
    # Preparar a mensagem com base no número de dias restantes
    if days_left == 0:
        message = (
            f"Olá {user.name or ''}! Seu plano *{product.name}* vence *hoje*. "
            f"Para renovar, basta enviar a palavra *COMPRAR* e seguir as instruções. "
            f"Ao renovar hoje, você evita a interrupção do serviço. Obrigado pela preferência!"
        )
    elif days_left == 1:
        message = (
            f"Olá {user.name or ''}! Seu plano *{product.name}* vence *amanhã*. "
            f"Para renovar, basta enviar a palavra *COMPRAR* e seguir as instruções. "
            f"Obrigado pela preferência!"
        )
    else:
        message = (
            f"Olá {user.name or ''}! Seu plano *{product.name}* vence em *{days_left} dias*. "
            f"Para renovar antecipadamente, basta enviar a palavra *COMPRAR* e seguir as instruções. "
            f"Obrigado pela preferência!"
        )
    
    try:
        # Enviar mensagem
        result = await whatsapp_bot.send_message(
            phone_number=user.whatsapp_number,
            message=message
        )
        
        if result and result.get("success"):
            logger.info(f"Lembrete enviado com sucesso para {user.whatsapp_number}")
            return True
        else:
            logger.error(f"Falha ao enviar lembrete para {user.whatsapp_number}: {result}")
            return False
    except Exception as e:
        logger.error(f"Erro ao enviar lembrete: {e}")
        return False

async def check_and_send_reminders():
    """
    Verifica assinaturas prestes a vencer e envia lembretes
    """
    db = next(get_db())
    whatsapp_bot = create_whatsapp_bot()
    
    try:
        now = datetime.utcnow()
        
        # Buscar assinaturas que vencem em breve (0, 3, 7 dias)
        reminder_days = [0, 2]  # Dias antes do vencimento para enviar lembretes
        
        for days in reminder_days:
            target_date = now.date() + timedelta(days=days)
            logger.info(f"Verificando assinaturas que vencem em {days} dias ({target_date})")
            
            # Buscar assinaturas que vencem na data alvo
            expiring_soon = db.query(Subscription).filter(
                Subscription.status == "active",
                Subscription.auto_renew == True,
                Subscription.expiry_date >= datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0),
                Subscription.expiry_date < datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59)
            ).all()
            
            logger.info(f"Encontradas {len(expiring_soon)} assinaturas vencendo em {days} dias")
            
            sent_count = 0
            for subscription in expiring_soon:
                # Verificar se já enviamos um lembrete recentemente (nas últimas 20 horas)
                if subscription.last_reminder_sent:
                    time_since_last = now - subscription.last_reminder_sent
                    if time_since_last < timedelta(hours=20):
                        logger.info(f"Ignorando assinatura {subscription.id} - lembrete enviado recentemente")
                        continue
                
                # Buscar usuário e produto
                user = db.query(User).filter(User.id == subscription.user_id).first()
                product = db.query(Product).filter(Product.id == subscription.product_id).first()
                
                if not user or not user.whatsapp_number:
                    logger.warning(f"Assinatura {subscription.id}: usuário não encontrado ou sem número")
                    continue
                
                if not product:
                    logger.warning(f"Assinatura {subscription.id}: produto não encontrado")
                    continue
                
                logger.info(f"Enviando lembrete para {user.whatsapp_number}, assinatura {subscription.id}")
                
                # Calcular dias restantes
                days_left = (subscription.expiry_date.date() - now.date()).days
                
                # Enviar lembrete
                success = await send_reminder(whatsapp_bot, user, product, subscription, days_left)
                
                if success:
                    # Atualizar timestamp do último lembrete
                    subscription.last_reminder_sent = now
                    db.commit()
                    sent_count += 1
            
            logger.info(f"Enviados {sent_count} lembretes para assinaturas vencendo em {days} dias")
        
        return True
    
    except Exception as e:
        logger.error(f"Erro no processamento de lembretes: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False
    finally:
        db.close()

async def mark_expired_subscriptions():
    """
    Marca assinaturas vencidas com o status 'expired'
    """
    db = next(get_db())
    
    try:
        now = datetime.utcnow()
        
        # Buscar assinaturas ativas que já venceram
        expired = db.query(Subscription).filter(
            Subscription.status == "active",
            Subscription.expiry_date < now
        ).all()
        
        logger.info(f"Encontradas {len(expired)} assinaturas vencidas para atualizar")
        
        for subscription in expired:
            subscription.status = "expired"
        
        db.commit()
        logger.info(f"{len(expired)} assinaturas marcadas como expiradas")
        
        return True
    
    except Exception as e:
        logger.error(f"Erro ao marcar assinaturas expiradas: {e}")
        return False
    finally:
        db.close()

async def main():
    """
    Função principal do script
    """
    logger.info("Iniciando verificação de assinaturas")
    
    # Marcar assinaturas expiradas
    await mark_expired_subscriptions()
    
    # Verificar e enviar lembretes
    await check_and_send_reminders()
    
    logger.info("Verificação de assinaturas concluída")

if __name__ == "__main__":
    asyncio.run(main())
