from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database_models import get_db
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# Rotas para gerenciamento de fluxos de chatbot
chatbot_router = APIRouter(prefix="/api/chatbot")

# Modelos de dados para validação
class ChatbotFlowStepCreate(BaseModel):
    step_order: int
    message_template: str
    expected_responses: Optional[str] = None
    action_type: str
    next_flow_id: Optional[int] = None

class ChatbotFlowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    active: bool = True
    steps: List[ChatbotFlowStepCreate]

class ChatbotFlowTriggerCreate(BaseModel):
    keyword: str
    is_exact_match: bool = False
    priority: int = 0

class ChatbotFlowTriggerResponse(BaseModel):
    id: int
    keyword: str
    is_exact_match: bool
    priority: int

class RedeemCodeCreate(BaseModel):
    code: str
    product_id: Optional[int] = None  # Tornar opcional para compatibilidade
    transaction_id: Optional[int] = None
    status: str = 'available'

@chatbot_router.post("/flows")
def create_chatbot_flow(flow: ChatbotFlowCreate, db: Session = Depends(get_db)):
    """
    Cria um novo fluxo de chatbot
    """
    from database_models import ChatbotFlow, ChatbotFlowStep
    
    # Cria fluxo principal
    new_flow = ChatbotFlow(
        name=flow.name,
        description=flow.description,
        active=flow.active
    )
    db.add(new_flow)
    db.flush()  # Gera ID para o fluxo
    
    # Cria passos do fluxo
    for step_data in flow.steps:
        new_step = ChatbotFlowStep(
            flow_id=new_flow.id,
            step_order=step_data.step_order,
            message_template=step_data.message_template,
            expected_responses=step_data.expected_responses,
            action_type=step_data.action_type,
            next_flow_id=step_data.next_flow_id
        )
        db.add(new_step)
    
    db.commit()
    return {"id": new_flow.id, "message": "Fluxo criado com sucesso"}

@chatbot_router.get("/flows")
def list_chatbot_flows(db: Session = Depends(get_db)):
    """
    Lista todos os fluxos de chatbot
    """
    from database_models import ChatbotFlow, ChatbotFlowStep, ChatbotFlowTrigger
    flows = db.query(ChatbotFlow).all()
    
    # Incluir informações sobre passos e gatilhos
    result = []
    for flow in flows:
        # Contar passos
        steps_count = db.query(ChatbotFlowStep).filter(
            ChatbotFlowStep.flow_id == flow.id
        ).count()
        
        # Buscar gatilhos
        triggers = db.query(ChatbotFlowTrigger).filter(
            ChatbotFlowTrigger.flow_id == flow.id
        ).all()
        
        # Formatar resposta
        flow_data = {
            "id": flow.id,
            "name": flow.name,
            "description": flow.description,
            "active": flow.active,
            "steps_count": steps_count,
            "triggers": [
                {
                    "id": trigger.id,
                    "keyword": trigger.keyword,
                    "is_exact_match": trigger.is_exact_match,
                    "priority": trigger.priority
                }
                for trigger in triggers
            ]
        }
        result.append(flow_data)
    
    return result

@chatbot_router.patch("/products/{code_id}/status")
def update_product_status(
    code_id: int, 
    status_data: dict,
    db: Session = Depends(get_db)
):
    """
    Atualiza apenas o status de um código de resgate
    """
    from database_models import RedeemCode
    
    existing_code = db.query(RedeemCode).filter(
        RedeemCode.id == code_id
    ).first()
    
    if not existing_code:
        raise HTTPException(status_code=404, detail="Código de resgate não encontrado")
    
    # Atualiza apenas o status
    if "status" in status_data and status_data["status"]:
        existing_code.status = status_data["status"]
        
    db.commit()
    
    return {"message": "Status do código atualizado com sucesso"}

@chatbot_router.get("/flows/{flow_id}")
def get_chatbot_flow(flow_id: int, db: Session = Depends(get_db)):
    """
    Obtém detalhes de um fluxo específico
    """
    from database_models import ChatbotFlow, ChatbotFlowStep, ChatbotFlowTrigger
    
    flow = db.query(ChatbotFlow).filter(ChatbotFlow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Fluxo não encontrado")
    
    # Obter passos do fluxo ordenados
    steps = db.query(ChatbotFlowStep).filter(
        ChatbotFlowStep.flow_id == flow_id
    ).order_by(ChatbotFlowStep.step_order).all()
    
    # Obter gatilhos do fluxo
    triggers = db.query(ChatbotFlowTrigger).filter(
        ChatbotFlowTrigger.flow_id == flow_id
    ).all()
    
    # Formatar resposta
    return {
        "id": flow.id,
        "name": flow.name,
        "description": flow.description,
        "active": flow.active,
        "steps": [
            {
                "id": step.id,
                "step_order": step.step_order,
                "message_template": step.message_template,
                "expected_responses": step.expected_responses,
                "action_type": step.action_type,
                "next_flow_id": step.next_flow_id
            }
            for step in steps
        ],
        "triggers": [
            {
                "id": trigger.id,
                "keyword": trigger.keyword,
                "is_exact_match": trigger.is_exact_match,
                "priority": trigger.priority
            }
            for trigger in triggers
        ]
    }

@chatbot_router.put("/flows/{flow_id}")
def update_chatbot_flow(flow_id: int, flow: ChatbotFlowCreate, db: Session = Depends(get_db)):
    """
    Atualiza um fluxo de chatbot existente
    """
    from database_models import ChatbotFlow, ChatbotFlowStep
    
    # Verificar se o fluxo existe
    db_flow = db.query(ChatbotFlow).filter(ChatbotFlow.id == flow_id).first()
    if not db_flow:
        raise HTTPException(status_code=404, detail="Fluxo não encontrado")
    
    # Atualizar dados básicos do fluxo
    db_flow.name = flow.name
    db_flow.description = flow.description
    db_flow.active = flow.active
    
    # Remover passos existentes
    db.query(ChatbotFlowStep).filter(ChatbotFlowStep.flow_id == flow_id).delete()
    
    # Criar novos passos
    for step_data in flow.steps:
        new_step = ChatbotFlowStep(
            flow_id=flow_id,
            step_order=step_data.step_order,
            message_template=step_data.message_template,
            expected_responses=step_data.expected_responses,
            action_type=step_data.action_type,
            next_flow_id=step_data.next_flow_id
        )
        db.add(new_step)
    
    db.commit()
    return {"message": "Fluxo atualizado com sucesso"}

@chatbot_router.delete("/flows/{flow_id}")
def delete_chatbot_flow(flow_id: int, db: Session = Depends(get_db)):
    """
    Remove um fluxo de chatbot
    """
    from database_models import ChatbotFlow, ChatbotFlowStep, ChatbotFlowTrigger
    
    # Verificar se o fluxo existe
    db_flow = db.query(ChatbotFlow).filter(ChatbotFlow.id == flow_id).first()
    if not db_flow:
        raise HTTPException(status_code=404, detail="Fluxo não encontrado")
    
    try:
        # Remover passos do fluxo
        db.query(ChatbotFlowStep).filter(ChatbotFlowStep.flow_id == flow_id).delete()
        
        # Remover gatilhos do fluxo
        db.query(ChatbotFlowTrigger).filter(ChatbotFlowTrigger.flow_id == flow_id).delete()
        
        # Remover o fluxo
        db.delete(db_flow)
        db.commit()
        
        return {"message": "Fluxo removido com sucesso"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao remover fluxo: {str(e)}")

@chatbot_router.post("/flows/{flow_id}/triggers")
def add_flow_trigger(flow_id: int, trigger: ChatbotFlowTriggerCreate, db: Session = Depends(get_db)):
    """
    Adiciona um gatilho (palavra-chave) a um fluxo
    """
    from database_models import ChatbotFlow, ChatbotFlowTrigger
    
    flow = db.query(ChatbotFlow).filter(ChatbotFlow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Fluxo não encontrado")
    
    new_trigger = ChatbotFlowTrigger(
        flow_id=flow_id,
        keyword=trigger.keyword,
        is_exact_match=trigger.is_exact_match,
        priority=trigger.priority
    )
    
    db.add(new_trigger)
    db.commit()
    db.refresh(new_trigger)
    
    return {
        "id": new_trigger.id, 
        "keyword": new_trigger.keyword,
        "is_exact_match": new_trigger.is_exact_match,
        "priority": new_trigger.priority,
        "message": "Gatilho adicionado com sucesso"
    }

@chatbot_router.delete("/flows/{flow_id}/triggers/{trigger_id}")
def delete_flow_trigger(flow_id: int, trigger_id: int, db: Session = Depends(get_db)):
    """
    Remove um gatilho de um fluxo
    """
    from database_models import ChatbotFlowTrigger
    
    trigger = db.query(ChatbotFlowTrigger).filter(
        ChatbotFlowTrigger.id == trigger_id,
        ChatbotFlowTrigger.flow_id == flow_id
    ).first()
    
    if not trigger:
        raise HTTPException(status_code=404, detail="Gatilho não encontrado")
    
    db.delete(trigger)
    db.commit()
    
    return {"message": "Gatilho removido com sucesso"}

@chatbot_router.get("/flows/{flow_id}/triggers")
def list_flow_triggers(flow_id: int, db: Session = Depends(get_db)):
    """
    Lista todos os gatilhos de um fluxo
    """
    from database_models import ChatbotFlow, ChatbotFlowTrigger
    
    flow = db.query(ChatbotFlow).filter(ChatbotFlow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Fluxo não encontrado")
    
    triggers = db.query(ChatbotFlowTrigger).filter(
        ChatbotFlowTrigger.flow_id == flow_id
    ).all()
    
    return [
        {
            "id": trigger.id,
            "keyword": trigger.keyword,
            "is_exact_match": trigger.is_exact_match,
            "priority": trigger.priority
        }
        for trigger in triggers
    ]

@chatbot_router.post("/products")
def create_redeemable_product(product: RedeemCodeCreate, db: Session = Depends(get_db)):
    """
    Cria um novo código de resgate
    """
    try:
        from database_models import RedeemCode, Product
        
        # Log para debug
        print(f"Recebido: {product}")
        
        # Verifica se o código de resgate já existe
        existing_code = db.query(RedeemCode).filter(
            RedeemCode.code == product.code
        ).first()
        
        if existing_code:
            raise HTTPException(status_code=400, detail="Código de resgate já existe")
        
        # Verifica se o produto existe quando product_id é fornecido
        if product.product_id:
            product_exists = db.query(Product).filter(Product.id == product.product_id).first()
            if not product_exists:
                raise HTTPException(status_code=404, detail="Produto não encontrado")
        
        # Criar o código de resgate
        new_code = RedeemCode(
            code=product.code,
            product_id=product.product_id,
            transaction_id=product.transaction_id,
            status=product.status or 'available'
        )
        
        db.add(new_code)
        db.commit()
        db.refresh(new_code)
        
        return {"id": new_code.id, "message": "Código de resgate criado com sucesso"}
    except Exception as e:
        db.rollback()
        print(f"Erro ao criar código de resgate: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erro ao criar código: {str(e)}")

@chatbot_router.get("/products")
def list_redeemable_products(db: Session = Depends(get_db)):
    """
    Lista todos os códigos de resgate
    """
    from database_models import RedeemCode
    codes = db.query(RedeemCode).all()
    return codes

@chatbot_router.put("/products/{code_id}")
def update_redeemable_product(
    code_id: int, 
    product: dict,  # Mudança para dict em vez de RedeemCodeCreate
    db: Session = Depends(get_db)
):
    """
    Atualiza um código de resgate
    """
    from database_models import RedeemCode
    
    existing_code = db.query(RedeemCode).filter(
        RedeemCode.id == code_id
    ).first()
    
    if not existing_code:
        raise HTTPException(status_code=404, detail="Código de resgate não encontrado")
    
    # Atualiza apenas os campos fornecidos
    if 'status' in product:
        existing_code.status = product['status']
    
    if 'code' in product:
        existing_code.code = product['code']
    
    db.commit()
    
    return {"message": "Código de resgate atualizado com sucesso"}