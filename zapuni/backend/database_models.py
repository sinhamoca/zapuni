from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship, sessionmaker, declarative_base
from datetime import datetime, timedelta

# Configuração do banco de dados
DATABASE_URL = "sqlite:////app/data/chatbot.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para modelos
Base = declarative_base()

class User(Base):
    """Modelo de usuário do WhatsApp"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    whatsapp_number = Column(String, unique=True, index=True)
    name = Column(String)
    registered_at = Column(DateTime, default=datetime.utcnow)
    
    # Adicione a linha de relacionamento exatamente aqui
    subscriptions = relationship("Subscription", back_populates="user")


class Product(Base):
    """Modelo de produtos/planos"""
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    description = Column(String)
    price = Column(Float)
    active = Column(Boolean, default=True)

class Transaction(Base):
    """Modelo de transações de compra"""
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    product_id = Column(Integer, ForeignKey('products.id'))
    amount = Column(Float)
    status = Column(String)  # pending, paid, cancelled
    payment_method = Column(String)  # pix, etc
    payment_method_id = Column(String, nullable=True)  # ID do pagamento na plataforma de pagamento
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
class RedeemCode(Base):
    """Modelo de códigos de resgate"""
    __tablename__ = "redeem_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True)
    product_id = Column(Integer, ForeignKey('products.id'))  # Adicionar esta linha
    transaction_id = Column(Integer, ForeignKey('transactions.id'))
    status = Column(String)  # available, expired
    created_at = Column(DateTime, default=datetime.utcnow)
    used_at = Column(DateTime, nullable=True)
    
    # Adicionar relacionamento com o produto
    product = relationship("Product")

class ChatbotFlow(Base):
    """Modelo de fluxos de chatbot"""
    __tablename__ = "chatbot_flows"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    description = Column(String)
    active = Column(Boolean, default=True)
    steps = relationship("ChatbotFlowStep", back_populates="flow")
    triggers = relationship("ChatbotFlowTrigger", back_populates="flow")

class ChatbotFlowStep(Base):
    """Modelo de passos dos fluxos de chatbot"""
    __tablename__ = "chatbot_flow_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    flow_id = Column(Integer, ForeignKey('chatbot_flows.id'))
    flow = relationship("ChatbotFlow", back_populates="steps")
    
    step_order = Column(Integer)
    message_template = Column(String)
    expected_responses = Column(String)
    action_type = Column(String)
    next_flow_id = Column(Integer, nullable=True)

class ChatbotFlowTrigger(Base):
    """Modelo de gatilhos/palavras-chave para fluxos de chatbot"""
    __tablename__ = "chatbot_flow_triggers"
    
    id = Column(Integer, primary_key=True, index=True)
    flow_id = Column(Integer, ForeignKey('chatbot_flows.id'))
    flow = relationship("ChatbotFlow", back_populates="triggers")
    
    keyword = Column(String)  # Palavra-chave que ativa o fluxo
    is_exact_match = Column(Boolean, default=False)  # Se precisa ser exatamente igual
    priority = Column(Integer, default=0)  # Prioridade para resolver conflitos
class Subscription(Base):
    """Modelo de assinaturas/planos recorrentes"""
    __tablename__ = "subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    product_id = Column(Integer, ForeignKey('products.id'))
    start_date = Column(DateTime, default=datetime.utcnow)
    expiry_date = Column(DateTime)
    status = Column(String)  # active, expired, canceled
    auto_renew = Column(Boolean, default=True)
    last_reminder_sent = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relacionamentos
    user = relationship("User", back_populates="subscriptions")
    product = relationship("Product")

class UserConversationState(Base):
    """Modelo para rastrear estado da conversa do usuário"""
    __tablename__ = "user_conversation_states"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    current_flow_id = Column(Integer, ForeignKey('chatbot_flows.id'), nullable=True)
    current_step_id = Column(Integer, ForeignKey('chatbot_flow_steps.id'), nullable=True)
    last_message_timestamp = Column(DateTime, default=datetime.utcnow)
    data = Column(String)  # JSON com dados coletados durante a conversa

class ResponseSettings(Base):
    """Modelo para configurações de resposta do chatbot"""
    __tablename__ = "response_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    respond_to_groups = Column(Boolean, default=True)
    respond_to_unsaved_contacts = Column(Boolean, default=True)
    respond_to_saved_contacts = Column(Boolean, default=True)
    respond_only_with_keyword = Column(Boolean, default=False)
    name_keyword = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Cria todas as tabelas no banco de dados
Base.metadata.create_all(bind=engine)

def get_db():
    """Cria uma sessão de banco de dados"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
