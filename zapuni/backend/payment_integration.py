import mercadopago
import uuid
import os
import time
from datetime import datetime, timedelta
from database_models import SessionLocal, Transaction, RedeemCode, Product, User
from sqlalchemy.orm import joinedload
from sqlalchemy import func, and_
from fastapi import HTTPException

class PaymentHandler:
    def __init__(self, access_token):
        """
        Inicializa o handler de pagamentos do Mercado Pago
        
        :param access_token: Token de acesso do Mercado Pago
        """
        self.sdk = mercadopago.SDK(access_token)

    def create_pix_payment(self, amount, product_name, user_id=None, product_id=None, email="email@exemplo.com"):
        """
        Cria um pagamento Pix
        
        :param amount: Valor do pagamento
        :param product_name: Nome do produto
        :param user_id: ID do usuário (opcional)
        :param product_id: ID do produto (opcional)
        :param email: Email do pagador
        :return: Dicionário com informações de pagamento
        """
        payment_data = {
            "transaction_amount": float(amount),
            "description": product_name,
            "payment_method_id": "pix",
            "payer": {
                "email": email
            }
        }
        
        try:
            payment_response = self.sdk.payment().create(payment_data)
            
            if payment_response["status"] == 201:
                # Salva transação no banco de dados
                with SessionLocal() as db:
                    transaction = Transaction(
                        user_id=user_id,
                        product_id=product_id,
                        amount=amount,
                        status="pending",
                        payment_method="pix",
                        payment_method_id=str(payment_response["response"]["id"])
                    )
                    db.add(transaction)
                    db.commit()
                    db.refresh(transaction)
                
                return {
                    "payment_id": payment_response["response"]["id"],
                    "qr_code": payment_response["response"]["point_of_interaction"]["transaction_data"]["qr_code"],
                    "qr_code_base64": payment_response["response"]["point_of_interaction"]["transaction_data"]["qr_code_base64"],
                    "transaction_id": transaction.id,
                    "expiration_date": payment_response["response"].get("date_of_expiration", None)
                }
            else:
                print(f"Erro ao criar pagamento: {payment_response}")
                return None
        
        except Exception as e:
            print(f"Erro ao criar pagamento Pix: {e}")
            return None

    def generate_redeem_code(self, transaction_id):
        """
        Busca um código de resgate disponível para uma transação
        
        :param transaction_id: ID da transação
        :return: Código de resgate ou erro
        """
        print(f"[DEBUG] Buscando código de resgate para transação {transaction_id}")
        
        with SessionLocal() as db:
            # Verificar se a transação existe e está paga
            transaction = db.query(Transaction).filter(
                Transaction.id == transaction_id
            ).first()
            
            if not transaction:
                error_msg = f"Transação {transaction_id} não encontrada"
                print(f"[DEBUG] {error_msg}")
                raise HTTPException(status_code=404, detail=error_msg)
            
            print(f"[DEBUG] Transação encontrada: ID={transaction.id}, Status={transaction.status}")
            
            if transaction.status != "approved" and transaction.status != "paid":
                error_msg = f"A transação {transaction_id} tem status '{transaction.status}', mas precisa estar como 'approved' ou 'paid'"
                print(f"[DEBUG] {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
            
            # Verificar se já existe um código para esta transação
            existing_code = db.query(RedeemCode).filter(
                RedeemCode.transaction_id == transaction_id
            ).first()
            
            if existing_code:
                print(f"[DEBUG] Código já existe: {existing_code.code}")
                return existing_code.code
            
            # Buscar um código disponível não associado a nenhuma transação
            available_code = db.query(RedeemCode).filter(
                RedeemCode.transaction_id == None,  # Códigos não associados a transações
                RedeemCode.status == "available",
                RedeemCode.product_id == transaction.product_id
            ).first()
            
            if not available_code:
                error_msg = "Não há códigos disponíveis para associar a esta transação"
                print(f"[DEBUG] {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
            
            # Associar o código à transação
            available_code.transaction_id = transaction_id
            available_code.status = "expired"
            db.commit()
            
            print(f"[DEBUG] Código {available_code.code} associado à transação {transaction_id}")
            return available_code.code
        
    def verify_payment(self, payment_id):
        """
        Verifica o status de um pagamento
        
        :param payment_id: ID do pagamento no Mercado Pago
        :return: Status do pagamento
        """
        try:
            print(f"[DEBUG] Iniciando verificação de pagamento com ID: {payment_id}")
            
            # Chamada direta e simplificada para a API
            print(f"[DEBUG] Chamando API do Mercado Pago para verificar pagamento")
            payment_info = self.sdk.payment().get(payment_id)
            
            print(f"[DEBUG] Código de status da resposta: {payment_info.get('status')}")
            if payment_info.get('response'):
                print(f"[DEBUG] Status do pagamento: {payment_info['response'].get('status')}")
                print(f"[DEBUG] Detalhes do status: {payment_info['response'].get('status_detail')}")
            
            if payment_info["status"] == 200:
                payment_status = payment_info["response"]["status"]
                payment_status_detail = payment_info["response"]["status_detail"]
                transaction_id = None  # Vamos armazenar o ID da transação aqui
                
                print(f"[DEBUG] Pagamento consultado com sucesso. Status: {payment_status}, Detalhes: {payment_status_detail}")
                
                with SessionLocal() as db:
                    print(f"[DEBUG] Buscando transação pelo payment_method_id: {payment_id}")
                    transaction = db.query(Transaction).filter(
                        Transaction.payment_method_id == str(payment_id)
                    ).first()
                    
                    if transaction:
                        # Armazenar o ID antes de fechar a sessão
                        transaction_id = transaction.id
                        
                        print(f"[DEBUG] Transação encontrada: ID={transaction.id}, Status atual={transaction.status}")
                        old_status = transaction.status
                        
                        if payment_status == "approved":
                            # Se aprovado, atualize o status para pago
                            transaction.status = "paid"
                            print(f"[DEBUG] Atualizando status da transação de '{old_status}' para 'paid'")
                        else:
                            transaction.status = payment_status
                            print(f"[DEBUG] Atualizando status da transação de '{old_status}' para '{payment_status}'")
                        
                        transaction.updated_at = datetime.utcnow()
                        db.commit()
                        print(f"[DEBUG] Transação atualizada com sucesso")
                    else:
                        print(f"[DEBUG] Nenhuma transação encontrada para payment_method_id: {payment_id}")
                
                # Agora usamos o valor armazenado em vez de acessar o objeto transaction
                return {
                    "status": payment_status,
                    "detail": payment_status_detail,
                    "transaction_id": transaction_id,  # Usando o valor armazenado
                    "is_approved": payment_status == "approved"
                }
            else:
                print(f"[DEBUG] Erro na resposta da API: status={payment_info['status']}")
                return {
                    "status": "error",
                    "detail": f"Erro ao consultar pagamento. Código de status: {payment_info['status']}",
                    "transaction_id": None,
                    "is_approved": False
                }
        
        except Exception as e:
            print(f"[DEBUG] Erro ao verificar pagamento: {type(e).__name__}: {str(e)}")
            
            # Logging com mais detalhes para facilitar o diagnóstico
            import traceback
            print(f"[DEBUG] Stack trace completo:")
            traceback.print_exc()
            
            return {
                "status": "error",
                "detail": str(e),
                "transaction_id": None,
                "is_approved": False
            }

    def redeem_code(self, code, user_whatsapp=None):
        """
        Resgata um código
        
        :param code: Código de resgate
        :param user_whatsapp: Número do WhatsApp do usuário (opcional)
        :return: Informações do produto associado ao código
        """
        with SessionLocal() as db:
            redeem_code = db.query(RedeemCode).filter(
                RedeemCode.code == code,
                RedeemCode.status == "available"
            ).options(
                joinedload(RedeemCode.transaction).joinedload(Transaction.product)
            ).first()
            
            if not redeem_code:
                return {
                    "success": False,
                    "message": "Código inválido ou já utilizado"
                }
            
            # Obter o produto relacionado à transação
            transaction = redeem_code.transaction
            if not transaction or not transaction.product:
                return {
                    "success": False,
                    "message": "Erro ao encontrar produto associado ao código"
                }
            
            # Marcar código como expirado em vez de utilizado
            redeem_code.status = "expired"  # Alterado de "used" para "expired"
            redeem_code.used_at = datetime.utcnow()
            
            # Se houver um usuário WhatsApp, registrar o uso
            if user_whatsapp:
                user = db.query(User).filter(
                    User.whatsapp_number == user_whatsapp
                ).first()
                
                if not user:
                    user = User(
                        whatsapp_number=user_whatsapp,
                        registered_at=datetime.utcnow()
                    )
                    db.add(user)
                    db.flush()
                
                # Atualizar a transação com o ID do usuário
                if not transaction.user_id:
                    transaction.user_id = user.id
            
            db.commit()
            
            return {
                "success": True,
                "message": "Código resgatado com sucesso",
                "product": {
                    "id": transaction.product.id,
                    "name": transaction.product.name,
                    "description": transaction.product.description,
                    "price": transaction.product.price
                }
            }

    def get_payment_statistics(self, days=30):
        """
        Obtém estatísticas de pagamentos
        
        :param days: Número de dias para filtrar (padrão: 30)
        :return: Estatísticas de pagamentos
        """
        with SessionLocal() as db:
            # Data limite
            date_limit = datetime.utcnow() - timedelta(days=days)
            
            # Total de transações
            total_transactions = db.query(Transaction).filter(
                Transaction.created_at >= date_limit
            ).count()
            
            # Total de transações pagas
            paid_transactions = db.query(Transaction).filter(
                and_(
                    Transaction.created_at >= date_limit,
                    Transaction.status == "paid"
                )
            ).count()
            
            # Receita total
            revenue = db.query(func.sum(Transaction.amount)).filter(
                and_(
                    Transaction.created_at >= date_limit,
                    Transaction.status == "paid"
                )
            ).scalar() or 0
            
            # Produtos mais vendidos
            top_products = db.query(
                Product.id, 
                Product.name, 
                func.count(Transaction.id).label("total_sales"),
                func.sum(Transaction.amount).label("total_revenue")
            ).join(
                Transaction, 
                Transaction.product_id == Product.id
            ).filter(
                and_(
                    Transaction.created_at >= date_limit,
                    Transaction.status == "paid"
                )
            ).group_by(
                Product.id, 
                Product.name
            ).order_by(
                func.count(Transaction.id).desc()
            ).limit(5).all()
            
            return {
                "total_transactions": total_transactions,
                "paid_transactions": paid_transactions,
                "revenue": float(revenue),
                "conversion_rate": (paid_transactions / total_transactions * 100) if total_transactions > 0 else 0,
                "top_products": [
                    {
                        "id": product.id,
                        "name": product.name,
                        "sales": product.total_sales,
                        "revenue": float(product.total_revenue)
                    } for product in top_products
                ]
            }

# Configuração de exemplo
def create_payment_handler():
    """
    Cria uma instância do handler de pagamentos
    """
    # Obter token do ambiente ou usar o padrão
    ACCESS_TOKEN = os.environ.get("MERCADO_PAGO_TOKEN", "APP_USR-5576722635004127-052013-18a4c17a7d7ba43339a0b7b2a17a2a48-1378109065")
    return PaymentHandler(ACCESS_TOKEN)
