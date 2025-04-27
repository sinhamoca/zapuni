// SubscriptionManagement.js
import React, { useState, useEffect } from 'react';
import { 
  Plus, Edit, Trash2, RefreshCw, Search, Calendar, Clock, 
  CheckCircle, XCircle, AlertCircle, Bell, Send, User
} from 'lucide-react';
import { subscriptionService } from '../api';

const SubscriptionManagement = () => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRemindersSending, setIsRemindersSending] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [error, setError] = useState(null);
  const [currentSubscription, setCurrentSubscription] = useState({
    user_id: '',
    product_id: '',
    expiry_date: '',
    status: 'active',
    auto_renew: true
  });
  const [newClient, setNewClient] = useState({
    name: '',
    whatsapp_number: ''
  });
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [expiringToday, setExpiringToday] = useState({ count: 0, subscriptions: [] });
  
  // Buscar assinaturas ao carregar
  useEffect(() => {
    fetchSubscriptions();
    fetchUsers();
    fetchProducts();
    fetchExpiringToday();
  }, []);

  // Buscar assinaturas da API
  const fetchSubscriptions = async () => {
    setIsLoading(true);
    try {
      const response = await subscriptionService.getAll();
      setSubscriptions(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao buscar assinaturas:', err);
      setError('Não foi possível carregar as assinaturas. Verifique a conexão com o backend.');
    } finally {
      setIsLoading(false);
    }
  };

  // Buscar usuários da API
  const fetchUsers = async () => {
    try {
      const response = await subscriptionService.getUsers();
      setUsers(response.data);
    } catch (err) {
      console.error('Erro ao buscar usuários:', err);
    }
  };

  // Buscar produtos da API
  const fetchProducts = async () => {
    try {
      const response = await subscriptionService.getProducts();
      setProducts(response.data);
    } catch (err) {
      console.error('Erro ao buscar produtos:', err);
    }
  };

  // Buscar assinaturas que vencem hoje
  const fetchExpiringToday = async () => {
    try {
      const response = await subscriptionService.getExpiringToday();
      setExpiringToday(response.data);
    } catch (err) {
      console.error('Erro ao buscar assinaturas vencendo hoje:', err);
    }
  };

  const handleAddSubscription = () => {
    // Preparar data de vencimento padrão para 30 dias no futuro
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    setCurrentSubscription({
      user_id: users.length > 0 ? users[0].id : '',
      product_id: products.length > 0 ? products[0].id : '',
      expiry_date: thirtyDaysFromNow.toISOString().split('T')[0],
      status: 'active',
      auto_renew: true
    });
    setIsModalOpen(true);
  };

  const handleEditSubscription = (subscription) => {
    // Formatar a data para o formato de input date
    const formattedDate = new Date(subscription.expiry_date)
      .toISOString().split('T')[0];
    
    setCurrentSubscription({
      id: subscription.id,
      user_id: subscription.user_id,
      product_id: subscription.product_id,
      expiry_date: formattedDate,
      status: subscription.status,
      auto_renew: subscription.auto_renew
    });
    setIsModalOpen(true);
  };
  const handleSaveSubscription = async () => {
    if (!currentSubscription.user_id || !currentSubscription.product_id || !currentSubscription.expiry_date) {
      setError('Usuário, produto e data de vencimento são obrigatórios.');
      return;
    }

    setIsLoading(true);
    try {
      if (currentSubscription.id) {
        // Atualizar assinatura existente
        await subscriptionService.update(
          currentSubscription.id, 
          {
            product_id: currentSubscription.product_id,
            expiry_date: new Date(currentSubscription.expiry_date).toISOString(),
            status: currentSubscription.status,
            auto_renew: currentSubscription.auto_renew
          }
        );
      } else {
        // Adicionar nova assinatura
        await subscriptionService.create({
          user_id: currentSubscription.user_id,
          product_id: currentSubscription.product_id,
          expiry_date: new Date(currentSubscription.expiry_date).toISOString(),
          status: currentSubscription.status,
          auto_renew: currentSubscription.auto_renew
        });
      }
      
      setIsModalOpen(false);
      fetchSubscriptions();
      fetchExpiringToday();
      setError(null);
    } catch (err) {
      console.error('Erro ao salvar assinatura:', err);
      setError('Não foi possível salvar a assinatura. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelSubscription = async (subscriptionId) => {
    if (!window.confirm('Tem certeza que deseja cancelar esta assinatura?')) {
      return;
    }
    
    setIsLoading(true);
    try {
      await subscriptionService.delete(subscriptionId);
      fetchSubscriptions();
      fetchExpiringToday();
    } catch (err) {
      console.error('Erro ao cancelar assinatura:', err);
      setError('Não foi possível cancelar a assinatura.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenewSubscription = async (subscriptionId, days = 30) => {
    setIsLoading(true);
    try {
      await subscriptionService.renew(subscriptionId, days);
      fetchSubscriptions();
      fetchExpiringToday();
      setError(null);
    } catch (err) {
      console.error('Erro ao renovar assinatura:', err);
      setError('Não foi possível renovar a assinatura.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendReminders = async () => {
    setIsRemindersSending(true);
    try {
      const response = await subscriptionService.sendReminders();
      alert(`Lembretes enviados: ${response.data.sent} de ${response.data.total}`);
      fetchExpiringToday();
    } catch (err) {
      console.error('Erro ao enviar lembretes:', err);
      alert('Erro ao enviar lembretes. Verifique se o WhatsApp está conectado.');
    } finally {
      setIsRemindersSending(false);
    }
  };

  // Função para criar novo cliente
  const handleCreateClient = async () => {
    if (!newClient.whatsapp_number) {
      setError('Número de WhatsApp é obrigatório.');
      return;
    }

    // Remover qualquer caractere não-numérico
    const formattedNumber = newClient.whatsapp_number.replace(/\D/g, '');
    
    setIsLoading(true);
    try {
      // Chamada à API para criar cliente
      const response = await subscriptionService.createUser({
        name: newClient.name,
        whatsapp_number: formattedNumber
      });
      
      // Atualizar lista de usuários
      await fetchUsers();
      
      // Fechar modal e limpar formulário
      setIsNewClientModalOpen(false);
      setNewClient({ name: '', whatsapp_number: '' });
      
      // Se a criação foi bem-sucedida, selecionar o cliente recém-criado
      if (response.data && response.data.id) {
        setCurrentSubscription({
          ...currentSubscription,
          user_id: response.data.id
        });
      }
      
      setError(null);
    } catch (err) {
      console.error('Erro ao criar cliente:', err);
      setError('Não foi possível criar o cliente. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  // Filtrar assinaturas com base na pesquisa e no status
  const filteredSubscriptions = subscriptions.filter(subscription => {
    const matchesSearch = 
      (subscription.user_name && subscription.user_name.toLowerCase().includes(search.toLowerCase())) ||
      (subscription.user_whatsapp && subscription.user_whatsapp.includes(search)) ||
      (subscription.product_name && subscription.product_name.toLowerCase().includes(search.toLowerCase()));
    
    const matchesStatus = selectedStatus === 'all' || subscription.status === selectedStatus;
    
    return matchesSearch && matchesStatus;
  });

  // Verificar se uma assinatura está vencida
  const isExpired = (expiryDate) => {
    return new Date(expiryDate) < new Date();
  };

  // Formatar data para exibição
  const formatDate = (dateString) => {
    const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
    return new Date(dateString).toLocaleDateString('pt-BR', options);
  };

  // Calcular dias até o vencimento
  const daysUntilExpiry = (expiryDate) => {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestão de Assinaturas</h1>
        <div className="flex space-x-2">
          {expiringToday.count > 0 && (
            <button 
              onClick={handleSendReminders}
              disabled={isRemindersSending}
              className="flex items-center px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50"
            >
              <Bell className="mr-2" size={18} /> 
              {isRemindersSending ? 'Enviando...' : `Enviar ${expiringToday.count} lembretes`}
            </button>
          )}
          <button 
            onClick={fetchSubscriptions}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50"
          >
            <RefreshCw className="mr-2" size={18} /> Atualizar
          </button>
          <button 
            onClick={handleAddSubscription}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            <Plus className="mr-2" /> Adicionar Assinatura
          </button>
        </div>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}

      {/* Resumo de Vencimentos */}
      {expiringToday.count > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
          <div className="flex items-center">
            <Calendar className="text-yellow-500 mr-2" />
            <h3 className="font-medium text-yellow-800">
              {expiringToday.count} {expiringToday.count === 1 ? 'assinatura vence' : 'assinaturas vencem'} hoje
            </h3>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[300px]">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, número ou produto..."
              className="w-full px-4 py-2 pl-10 border rounded"
            />
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
          </div>
        </div>
        
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="expired">Expirado</option>
          <option value="canceled">Cancelado</option>
        </select>
      </div>

      {/* Lista de Assinaturas */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {isLoading && !isModalOpen ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-gray-500">Carregando assinaturas...</p>
          </div>
        ) : filteredSubscriptions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plano</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vencimento</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Auto-Renovação</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSubscriptions.map((subscription) => (
                  <tr key={subscription.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{subscription.user_name || 'Sem nome'}</div>
                      <div className="text-sm text-gray-500">{subscription.user_whatsapp}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{subscription.product_name}</div>
                      {subscription.product_price && (
                        <div className="text-sm text-gray-500">
                          R$ {subscription.product_price.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium">
                        {formatDate(subscription.expiry_date)}
                      </div>
                      <div className={`text-sm ${
                        isExpired(subscription.expiry_date) 
                          ? 'text-red-500' 
                          : daysUntilExpiry(subscription.expiry_date) <= 5 
                            ? 'text-yellow-500' 
                            : 'text-gray-500'
                      }`}>
                        {isExpired(subscription.expiry_date) 
                          ? 'Vencido' 
                          : `Faltam ${daysUntilExpiry(subscription.expiry_date)} dias`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        subscription.status === 'active' ? 'bg-green-100 text-green-800' :
                        subscription.status === 'expired' ? 'bg-red-100 text-red-800' :
                        subscription.status === 'canceled' ? 'bg-gray-100 text-gray-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {subscription.status === 'active' ? 'Ativo' :
                        subscription.status === 'expired' ? 'Expirado' :
                        subscription.status === 'canceled' ? 'Cancelado' : 
                        subscription.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {subscription.auto_renew ? (
                        <span className="text-green-600 flex items-center">
                          <CheckCircle size={16} className="mr-1" /> Sim
                        </span>
                      ) : (
                        <span className="text-red-600 flex items-center">
                          <XCircle size={16} className="mr-1" /> Não
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <div className="flex justify-center space-x-2">
                        <button 
                          onClick={() => handleRenewSubscription(subscription.id)}
                          className="text-green-600 hover:text-green-800"
                          title="Renovar assinatura por 30 dias"
                        >
                          <RefreshCw size={18} />
                        </button>
                        <button 
                          onClick={() => handleEditSubscription(subscription)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Editar assinatura"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => handleCancelSubscription(subscription.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Cancelar assinatura"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <p>Nenhuma assinatura encontrada.</p>
            <p className="text-sm mt-2">
              {search || selectedStatus !== 'all' 
                ? 'Tente ajustar os filtros de busca.' 
                : 'Clique em "Adicionar Assinatura" para cadastrar sua primeira assinatura.'}
            </p>
          </div>
        )}
      </div>
{/* Modal de Adicionar/Editar Assinatura */}
{isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">
              {currentSubscription.id ? 'Editar Assinatura' : 'Adicionar Assinatura'}
            </h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Cliente</label>
                <div className="flex space-x-2">
                  <select
                    value={currentSubscription.user_id}
                    onChange={(e) => setCurrentSubscription({
                      ...currentSubscription,
                      user_id: e.target.value
                    })}
                    className="w-full p-2 border rounded"
                  >
                    <option value="">Selecione um cliente</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.name || 'Sem nome'} ({user.whatsapp_number})
                      </option>
                    ))}
                  </select>
                  <button 
                    onClick={() => setIsNewClientModalOpen(true)}
                    className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    title="Adicionar novo cliente"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Plano</label>
                <select
                  value={currentSubscription.product_id}
                  onChange={(e) => setCurrentSubscription({
                    ...currentSubscription,
                    product_id: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                >
                  <option value="">Selecione um plano</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id}>
                      {product.name} - R$ {product.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Data de Vencimento</label>
                <input 
                  type="date"
                  value={currentSubscription.expiry_date}
                  onChange={(e) => setCurrentSubscription({
                    ...currentSubscription,
                    expiry_date: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Status</label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentSubscription.status === 'active'}
                      onChange={() => setCurrentSubscription({
                        ...currentSubscription,
                        status: 'active'
                      })}
                      className="mr-2"
                    />
                    Ativo
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentSubscription.status === 'expired'}
                      onChange={() => setCurrentSubscription({
                        ...currentSubscription,
                        status: 'expired'
                      })}
                      className="mr-2"
                    />
                    Expirado
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentSubscription.status === 'canceled'}
                      onChange={() => setCurrentSubscription({
                        ...currentSubscription,
                        status: 'canceled'
                      })}
                      className="mr-2"
                    />
                    Cancelado
                  </label>
                </div>
              </div>
              
              <div>
                <label className="flex items-center">
                  <input 
                    type="checkbox"
                    checked={currentSubscription.auto_renew}
                    onChange={(e) => setCurrentSubscription({
                      ...currentSubscription,
                      auto_renew: e.target.checked
                    })}
                    className="mr-2 h-4 w-4"
                  />
                  <span>Auto-renovação (enviar lembretes)</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  Se ativado, o sistema enviará lembretes de renovação quando estiver próximo do vencimento.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border rounded hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveSubscription}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para criar novo cliente */}
      {isNewClientModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <User className="mr-2" size={20} /> Adicionar Novo Cliente
            </h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Nome</label>
                <input 
                  type="text"
                  value={newClient.name}
                  onChange={(e) => setNewClient({
                    ...newClient, 
                    name: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Nome do cliente"
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Número WhatsApp</label>
                <input 
                  type="text"
                  value={newClient.whatsapp_number}
                  onChange={(e) => setNewClient({
                    ...newClient, 
                    whatsapp_number: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Ex: 5511999999999"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Digite apenas números, incluindo código do país e DDD.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setIsNewClientModalOpen(false)}
                className="px-4 py-2 border rounded hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button 
                onClick={handleCreateClient}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Salvar Cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ajuda */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-medium mb-2 text-blue-800">Como funciona o sistema de assinaturas?</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
          <li>As assinaturas permitem controlar clientes que pagam regularmente por seus produtos/serviços.</li>
          <li>O sistema enviará lembretes automáticos via WhatsApp quando uma assinatura estiver próxima do vencimento.</li>
          <li>Quando um cliente responde com a palavra-chave definida (ex: "COMPRAR"), ele recebe o fluxo de renovação.</li>
          <li>Após o pagamento, a assinatura é automaticamente renovada por mais um período.</li>
          <li>As assinaturas com auto-renovação ativada receberão lembretes de vencimento.</li>
        </ul>
      </div>
      
      {/* Estado de Carregamento Global */}
      {isLoading && isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionManagement;