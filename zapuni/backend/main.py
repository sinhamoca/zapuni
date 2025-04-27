from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database_models import Base, engine, get_db
import os
from fastapi.staticfiles import StaticFiles

# Importar routers
from whatsapp_routes import whatsapp_router
from chatbot_management_endpoints import chatbot_router
from subscription_endpoints import subscription_router
from mass_messaging_endpoints import mass_messaging_router  # Nova importação

# Criar diretórios necessários
os.makedirs("temp_images", exist_ok=True)
os.makedirs("data", exist_ok=True)

# Criar aplicação FastAPI
app = FastAPI(title="Chatbot Admin API")

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, especifique as origens permitidas
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(whatsapp_router)
app.include_router(chatbot_router)
app.include_router(subscription_router)
app.include_router(mass_messaging_router)  # Novo router adicionado

# Montar diretório de imagens temporárias
app.mount("/temp_images", StaticFiles(directory="temp_images"), name="temp_images")

@app.get("/")
async def root():
    return {"message": "Chatbot Admin API"}


@app.get("/api/dashboard-data")
async def get_dashboard_data(db: Session = Depends(get_db)):
    """
    Retorna dados para o dashboard
    """
    from database_models import User, Transaction, Product
    from payment_integration import create_payment_handler
    
    # Criar handler de pagamento
    payment_handler = create_payment_handler()
    
    # Obter estatísticas de pagamento dos últimos 30 dias
    payment_stats = payment_handler.get_payment_statistics(days=30)
    
    # Obter contagem total de usuários
    total_users = db.query(User).count()
    
    return {
        "total_users": total_users,
        "total_transactions": payment_stats["total_transactions"],
        "total_revenue": payment_stats["revenue"],
        "top_products": payment_stats["top_products"]
    }

@app.get("/api/products")
def list_products(db: Session = Depends(get_db)):
    """
    Lista todos os produtos disponíveis
    """
    from database_models import Product
    products = db.query(Product).all()
    return [
        {
            "id": product.id,
            "name": product.name,
            "description": product.description,
            "price": product.price,
            "active": product.active
        } for product in products
    ]

@app.post("/api/products")
def create_product(product: dict, db: Session = Depends(get_db)):
    """
    Cria um novo produto
    """
    from database_models import Product
    try:
        new_product = Product(
            name=product.get("name"),
            description=product.get("description"),
            price=product.get("price"),
            active=product.get("active", True)
        )
        db.add(new_product)
        db.commit()
        db.refresh(new_product)
        return {
            "id": new_product.id,
            "name": new_product.name,
            "description": new_product.description,
            "price": new_product.price,
            "active": new_product.active
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar produto: {str(e)}")

@app.put("/api/products/{product_id}")
def update_product(product_id: int, product: dict, db: Session = Depends(get_db)):
    """
    Atualiza um produto existente
    """
    from database_models import Product
    db_product = db.query(Product).filter(Product.id == product_id).first()
    
    if not db_product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    try:
        db_product.name = product.get("name")
        db_product.description = product.get("description")
        db_product.price = product.get("price")
        db_product.active = product.get("active")
        
        db.commit()
        db.refresh(db_product)
        
        return {
            "id": db_product.id,
            "name": db_product.name,
            "description": db_product.description,
            "price": db_product.price,
            "active": db_product.active
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar produto: {str(e)}")

@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    """
    Remove um produto
    """
    from database_models import Product
    db_product = db.query(Product).filter(Product.id == product_id).first()
    
    if not db_product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    try:
        db.delete(db_product)
        db.commit()
        return {"message": "Produto removido com sucesso"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao remover produto: {str(e)}")

@app.get("/api/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    """
    Obtém detalhes de um produto específico
    """
    from database_models import Product
    product = db.query(Product).filter(Product.id == product_id, Product.active == True).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "price": product.price
    }

@app.get("/api/users")
def list_users(db: Session = Depends(get_db)):
    """
    Lista todos os usuários/clientes
    """
    from database_models import User
    users = db.query(User).all()
    
    return [
        {
            "id": user.id,
            "name": user.name or "Cliente sem nome",
            "whatsapp_number": user.whatsapp_number,
            "registered_at": user.registered_at
        } for user in users
    ]

@app.post("/api/users")
def create_user(user: dict, db: Session = Depends(get_db)):
    """
    Cria um novo usuário/cliente
    """
    from database_models import User
    # Validar número de WhatsApp
    if not user.get("whatsapp_number"):
        raise HTTPException(status_code=400, detail="Número de WhatsApp é obrigatório")
    
    # Verificar se o usuário já existe
    existing = db.query(User).filter(User.whatsapp_number == user["whatsapp_number"]).first()
    if existing:
        return {
            "id": existing.id,
            "name": existing.name,
            "whatsapp_number": existing.whatsapp_number,
            "registered_at": existing.registered_at
        }
    
    # Criar novo usuário
    new_user = User(
        name=user.get("name", ""),
        whatsapp_number=user["whatsapp_number"],
        registered_at=datetime.utcnow()
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {
        "id": new_user.id,
        "name": new_user.name,
        "whatsapp_number": new_user.whatsapp_number,
        "registered_at": new_user.registered_at
    }

@app.post("/api/generate-payment")
def generate_payment(request: dict, db: Session = Depends(get_db)):
    """
    Gera um pagamento Pix para um produto específico
    """
    from database_models import Product
    from payment_integration import create_payment_handler
    
    product_id = request.get("product_id")
    if not product_id:
        raise HTTPException(status_code=400, detail="ID do produto é obrigatório")
    
    product = db.query(Product).filter(Product.id == product_id, Product.active == True).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    # Cria pagamento Pix
    payment_handler = create_payment_handler()
    payment_info = payment_handler.create_pix_payment(
        amount=product.price, 
        product_name=product.name,
        user_id=request.get("user_id"),
        product_id=product.id,
        email=request.get("email") or "cliente@exemplo.com"
    )
    
    if not payment_info:
        raise HTTPException(status_code=500, detail="Erro ao gerar pagamento")
    
    return {
        "payment_id": payment_info['payment_id'],
        "qr_code": payment_info['qr_code'],
        "qr_code_base64": payment_info['qr_code_base64'],
        "transaction_id": payment_info['transaction_id'],
        "expiration_date": payment_info['expiration_date']
    }

@app.post("/api/verify-payment")
def verify_payment(request: dict):
    """
    Verifica o status de um pagamento
    """
    from payment_integration import create_payment_handler
    
    payment_id = request.get("payment_id")
    if not payment_id:
        raise HTTPException(status_code=400, detail="ID do pagamento é obrigatório")
    
    payment_handler = create_payment_handler()
    payment_status = payment_handler.verify_payment(payment_id)
    
    return payment_status

# Endpoint modificado para usar códigos pré-criados
@app.post("/api/redeem-code")
def redeem_code(request: dict, db: Session = Depends(get_db)):
    """
    Associa código de resgate para uma transação
    """
    from database_models import Transaction, RedeemCode
    try:
        transaction_id = request.get("transaction_id")
        if not transaction_id:
            return {
                "success": False,
                "message": "ID da transação é obrigatório"
            }
        
        # Verificamos se a transação existe e está paga
        transaction = db.query(Transaction).filter(
            Transaction.id == transaction_id
        ).first()
        
        if not transaction:
            return {
                "success": False,
                "message": "Transação não encontrada"
            }
        
        if transaction.status != "approved" and transaction.status != "paid":
            return {
                "success": False,
                "message": "Transação não está paga"
            }
        
        # Buscar códigos disponíveis
        available_code = db.query(RedeemCode).filter(
            RedeemCode.transaction_id == None,
            RedeemCode.status == "available"
        ).first()
        
        if not available_code:
            return {
                "success": False,
                "message": "Não há códigos disponíveis para associar"
            }
        
        # Associar à transação
        available_code.transaction_id = transaction.id
        db.commit()
        
        return {
            "success": True,
            "redeem_code": available_code.code
        }
    except Exception as e:
        if 'db' in locals():
            db.rollback()
        return {
            "success": False,
            "message": str(e)
        }

# Novo endpoint para criar códigos manualmente
@app.post("/api/chatbot/generate-codes")
def generate_codes(request: dict, db: Session = Depends(get_db)):
    """
    Gera múltiplos códigos de resgate manualmente
    """
    from database_models import RedeemCode
    import uuid
    from datetime import datetime
    
    try:
        quantity = request.get("quantity", 1)
        code_format = request.get("code_format")
        
        if not isinstance(quantity, int) or quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantidade deve ser um número positivo")
        
        db = next(get_db())
        codes_created = []
        
        for i in range(quantity):
            # Gerar código personalizado se um formato estiver especificado
            if code_format:
                # Substituir {i} pelo índice atual (começando em 1)
                code = code_format.replace("{i}", str(i+1))
                # Substituir {uuid} por um UUID aleatório
                if "{uuid}" in code:
                    code = code.replace("{uuid}", str(uuid.uuid4())[:8].upper())
            else:
                # Se não há formato específico, usar um código aleatório
                code = str(uuid.uuid4())[:12].upper()
            
            # Verificar se o código já existe
            existing = db.query(RedeemCode).filter(RedeemCode.code == code).first()
            if existing:
                continue  # Pular e tentar novamente
            
            # Criar novo código
            new_code = RedeemCode(
                code=code,
                transaction_id=None,  # Não associado a nenhuma transação inicialmente
                status="available",
                created_at=datetime.now()
            )
            db.add(new_code)
            codes_created.append(code)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"{len(codes_created)} códigos criados com sucesso",
            "codes": codes_created
        }
    except Exception as e:
        if 'db' in locals():
            db.rollback()
        return {
            "success": False,
            "message": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    # Usar host 0.0.0.0 para permitir acesso externo
    uvicorn.run(app, host="0.0.0.0", port=8000)
