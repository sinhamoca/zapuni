#!/usr/bin/env python
"""
Versão simplificada do script para criar um fluxo de renovação de assinatura.
"""

import sys
import logging
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Importar diretamente do arquivo
from database_models import get_db, ChatbotFlow, ChatbotFlowStep, ChatbotFlowTrigger

def create_renewal_flow():
    """Cria um fluxo de chatbot para renovação de assinaturas"""
    logger.info("Criando fluxo de renovação de assinatura...")
    
    db = next(get_db())
    
    try:
        # Verificar se o fluxo já existe usando SQL direto
        existing_flow = db.execute("SELECT id FROM chatbot_flows WHERE name = 'Renovação de Assinatura'").fetchone()
        
        if existing_flow:
            flow_id = existing_flow[0]
            logger.info(f"Fluxo 'Renovação de Assinatura' já existe com ID {flow_id}")
            return flow_id
        
        # 1. Criar fluxo principal
        new_flow = ChatbotFlow(
            name='Renovação de Assinatura',
            description='Fluxo para renovação de assinaturas com vencimento próximo',
            active=True
        )
        
        db.add(new_flow)
        db.commit()
        db.refresh(new_flow)
        
        flow_id = new_flow.id
        logger.info(f"Fluxo criado com ID: {flow_id}")
        
        # 2. Adicionar passos do fluxo
        steps = [
            # Passo 1: Mensagem inicial de boas-vindas
            ChatbotFlowStep(
                flow_id=flow_id,
                step_order=1,
                message_template='Olá! Identificamos que você tem uma assinatura ativa conosco. Você deseja renovar sua assinatura?',
                expected_responses='sim,não,s,n',
                action_type='collect_input',
                next_flow_id=None
            ),
            # Passos restantes conforme o script original
            # ...adicione os outros passos aqui
        ]
        
        # Adicione um passo de cada vez para evitar erros
        for step in steps:
            db.add(step)
            db.commit()
        
        # 3. Adicionar gatilhos (palavras-chave) para o fluxo
        triggers = [
            ChatbotFlowTrigger(
                flow_id=flow_id,
                keyword='comprar',
                is_exact_match=False,
                priority=10
            ),
            # Adicione os outros gatilhos aqui
        ]
        
        for trigger in triggers:
            db.add(trigger)
            db.commit()
        
        logger.info(f"Fluxo 'Renovação de Assinatura' criado com sucesso (ID: {flow_id})")
        
        return flow_id
    
    except Exception as e:
        db.rollback()
        logger.error(f"Erro ao criar fluxo: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None

if __name__ == "__main__":
    flow_id = create_renewal_flow()
    
    if flow_id:
        print(f"Fluxo de renovação criado com sucesso! ID: {flow_id}")
        sys.exit(0)
    else:
        print("Falha ao criar fluxo de renovação. Verifique os logs para mais detalhes.")
        sys.exit(1)
