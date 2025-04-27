import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Produtos
export const productService = {
  getAll: () => api.get('/api/products'),
  getById: (id) => api.get(`/api/products/${id}`),
  create: (product) => api.post('/api/products', product),
  update: (id, product) => api.put(`/api/products/${id}`, product),
  delete: (id) => api.delete(`/api/products/${id}`),
};

// Fluxos de Chatbot
export const chatbotFlowService = {
  getAll: () => api.get('/api/chatbot/flows'),
  getById: (id) => api.get(`/api/chatbot/flows/${id}`),
  create: (flow) => api.post('/api/chatbot/flows', flow),
  update: (id, flow) => api.put(`/api/chatbot/flows/${id}`, flow),
  delete: (id) => api.delete(`/api/chatbot/flows/${id}`),
  
  // Gerenciamento de gatilhos (palavras-chave)
  addTrigger: (flowId, trigger) => api.post(`/api/chatbot/flows/${flowId}/triggers`, trigger),
  removeTrigger: (flowId, triggerId) => api.delete(`/api/chatbot/flows/${flowId}/triggers/${triggerId}`),
  listTriggers: (flowId) => api.get(`/api/chatbot/flows/${flowId}/triggers`),
};

// Códigos de Resgate
export const redeemCodeService = {
  getAll: () => api.get('/api/chatbot/products'),
  generate: (transactionId) => api.post('/api/redeem-code', { transaction_id: transactionId }),
  // Novo método usando PATCH para atualizar apenas o status
  expire: (codeId) => api.patch(`/api/chatbot/products/${codeId}/status`, { 
    status: 'expired' 
  }),
  // Método para marcar como disponível
  makeAvailable: (codeId) => api.patch(`/api/chatbot/products/${codeId}/status`, { 
    status: 'available' 
  }),
  // Métodos para criação e gerenciamento manual de códigos
  create: (codeData) => api.post('/api/chatbot/products', {
    code: codeData.code,
    product_id: codeData.product_id || null,  
    transaction_id: codeData.transaction_id || null,
    status: codeData.status || 'available'
  }),
  // Método antigo - mantido para compatibilidade
  update: (codeId, codeData) => api.put(`/api/chatbot/products/${codeId}`, codeData),
};

// Serviço de Pagamento
export const paymentService = {
  generatePayment: (productId) => api.post('/api/generate-payment', { product_id: productId }),
  verifyPayment: (paymentId) => api.post('/api/verify-payment', { payment_id: paymentId }),
  generateRedeemCode: (transactionId) => api.post('/api/redeem-code', { transaction_id: transactionId }),
  getProduct: (productId) => api.get(`/api/products/${productId}`)
};

// Dados do Dashboard
export const dashboardService = {
  getData: () => api.get('/api/dashboard-data'),
};

// Serviço WhatsApp
export const whatsappService = {
  getStatus: () => api.get('/api/whatsapp/status'),
  generateQR: () => api.post('/api/whatsapp/generate-qr'),
  disconnect: () => api.post('/api/whatsapp/disconnect'),
  reloadSession: () => api.post('/api/whatsapp/reload-session'),
  sendMessage: (phoneNumber, message, metadata) => api.post('/api/whatsapp/send-message', {
    phone_number: phoneNumber,
    message: message,
    metadata: metadata
  }),
  // Funções para configurações de resposta
  getResponseSettings: () => api.get('/api/whatsapp/response-settings'),
  saveResponseSettings: (settings) => api.post('/api/whatsapp/response-settings', settings),
  // Nova função para verificar informações de contato
  getContactInfo: (phoneNumber) => api.get(`/api/whatsapp/contact-info/${phoneNumber}`),
  // Nova função para enviar imagem
  sendImageMessage: (formData) => api.post('/api/whatsapp/send-image-message', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  }),
};

// Novo endpoint para geração em massa de códigos
export const codeGenerationService = {
  generateCodes: (quantity, codeFormat) => api.post('/api/chatbot/generate-codes', {
    quantity: quantity,
    code_format: codeFormat
  }),
};

// Serviço de Assinaturas
export const subscriptionService = {
  getAll: (filters = {}) => {
    let url = '/api/subscriptions';
    // Adicionar parâmetros de filtro se fornecidos
    if (filters.status) url += `?status=${filters.status}`;
    if (filters.expired !== undefined) {
      url += url.includes('?') ? `&expired=${filters.expired}` : `?expired=${filters.expired}`;
    }
    return api.get(url);
  },
  getById: (id) => api.get(`/api/subscriptions/${id}`),
  getByUser: (userId) => api.get(`/api/subscriptions/user/${userId}`),
  getByWhatsApp: (phoneNumber) => api.get(`/api/subscriptions/whatsapp/${phoneNumber}`),
  create: (subscription) => api.post('/api/subscriptions', subscription),
  update: (id, subscription) => api.put(`/api/subscriptions/${id}`, subscription),
  delete: (id) => api.delete(`/api/subscriptions/${id}`),
  renew: (id, days = 30) => api.post(`/api/subscriptions/${id}/renew`, { days }),
  getExpiringToday: () => api.get('/api/subscriptions/expiring/today'),
  sendReminders: () => api.post('/api/subscriptions/send-reminders'),
  
  // Métodos auxiliares para obter usuários e produtos
  getUsers: () => api.get('/api/users'),
  getProducts: () => api.get('/api/products'),
  
  // Novo método para criar usuários
  createUser: (userData) => api.post('/api/users', userData)
};

// Serviço de Envio em Massa
export const massMessagingService = {
  // Obter estatísticas de segmentos
  getSegments: () => api.get('/api/mass-messaging/segments'),
  
  // Enviar mensagem em massa
  sendMassMessage: (data) => api.post('/api/mass-messaging/send', data),
  
  // Fazer upload de imagem
  uploadImage: (formData) => api.post('/api/mass-messaging/upload-image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  }),
  
  // Verificar status de um envio
  getStatus: (taskId) => api.get(`/api/mass-messaging/status/${taskId}`),
  
  // Obter histórico de envios
  getHistory: () => api.get('/api/mass-messaging/history')
};

export default api;
