import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, Download, Copy, Check, RefreshCw } from 'lucide-react';
import { redeemCodeService, productService } from '../api';

const RedeemCodes = () => {
  const [codes, setCodes] = useState([]);
  const [products, setProducts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [copiedCode, setCopiedCode] = useState(null);
  const [error, setError] = useState(null);
  const [currentCode, setCurrentCode] = useState({
    code: '',
    product_id: '',
    status: 'available'
  });
  
  // Buscar códigos e produtos ao carregar
  useEffect(() => {
    fetchRedeemCodes();
    fetchProducts();
  }, []);

  // Buscar códigos da API
  const fetchRedeemCodes = async () => {
    setIsLoading(true);
    try {
      // Tentamos buscar da API real. Se falhar, usamos dados de exemplo
      const response = await redeemCodeService.getAll().catch(() => {
        return { 
          data: [
            { id: 1, code: 'ABC12345', status: 'available', product_name: 'Plano Básico', price: 50.00, created_at: '2023-01-01T00:00:00Z' },
            { id: 2, code: 'XYZ67890', status: 'expired', product_name: 'Plano Avançado', price: 100.00, created_at: '2023-01-02T00:00:00Z', used_at: '2023-01-05T00:00:00Z' }
          ]
        };
      });
      
      setCodes(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao buscar códigos:', err);
      setError('Não foi possível carregar os códigos de resgate. Verifique a conexão com o backend.');
    } finally {
      setIsLoading(false);
    }
  };

  // Buscar produtos para associar aos códigos
  const fetchProducts = async () => {
    try {
      const response = await productService.getAll().catch(() => {
        return { 
          data: [
            { id: 1, name: 'Plano Básico', price: 50.00 },
            { id: 2, name: 'Plano Avançado', price: 100.00 }
          ]
        };
      });
      
      setProducts(response.data);
    } catch (err) {
      console.error('Erro ao buscar produtos:', err);
    }
  };

  // Abrir modal para adicionar código
  const handleAddCode = () => {
    // Inicializar com o primeiro produto da lista, se disponível
    const initialProductId = products.length > 0 ? products[0].id : '';
    
    setCurrentCode({
      code: generateRandomCode(),
      product_id: initialProductId,
      status: 'available'
    });
    setIsModalOpen(true);
  };

  // Gerar código aleatório
  const generateRandomCode = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    // Aumentando para 12 caracteres em vez de 8
    for (let i = 0; i < 12; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  // Salvar código
  const handleSaveCode = async () => {
    if (!currentCode.code) {
      setError('Código é obrigatório.');
      return;
    }

    if (!currentCode.product_id) {
      setError('É necessário selecionar um produto.');
      return;
    }

    setIsLoading(true);
    try {
      // Aqui enviamos para API - em ambiente real
      await redeemCodeService.create(currentCode).catch((err) => {
        console.error('Erro ao criar código:', err);
        // Fallback para ambiente de desenvolvimento
        setCodes(prev => [...prev, {
          id: Math.max(0, ...prev.map(c => c.id)) + 1,
          code: currentCode.code,
          status: currentCode.status,
          product_name: products.find(p => p.id === parseInt(currentCode.product_id))?.name || 'Produto',
          price: products.find(p => p.id === parseInt(currentCode.product_id))?.price || 0,
          created_at: new Date().toISOString()
        }]);
      });
      
      setIsModalOpen(false);
      fetchRedeemCodes();
      setError(null);
    } catch (err) {
      console.error('Erro ao salvar código:', err);
      setError('Não foi possível salvar o código. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  // Nova função para alternar o status do código
  const handleToggleStatus = async (code) => {
    const newStatus = code.status === 'available' ? 'expired' : 'available';
    const actionText = newStatus === 'expired' ? 'expirar' : 'reativar';
    
    if (!window.confirm(`Tem certeza que deseja ${actionText} este código?`)) {
      return;
    }
    
    setIsLoading(true);
    try {
      if (newStatus === 'expired') {
        await redeemCodeService.expire(code.id);
      } else {
        await redeemCodeService.makeAvailable(code.id);
      }
      
      // Atualizar a lista de códigos
      fetchRedeemCodes();
      setError(null);
    } catch (err) {
      console.error(`Erro ao ${actionText} código:`, err);
      setError(`Não foi possível ${actionText} o código.`);
    } finally {
      setIsLoading(false);
    }
  };

  // Copiar código para a área de transferência
  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Exportar códigos para CSV
  const exportCodes = () => {
    const headers = ['Código', 'Status', 'Produto', 'Preço', 'Data de Criação', 'Data de Uso'];
    
    const csvContent = [
      headers.join(','),
      ...filteredCodes.map(code => [
        code.code,
        code.status,
        code.product_name,
        `R$ ${code.price?.toFixed(2) || "0.00"}`,
        new Date(code.created_at).toLocaleDateString(),
        code.used_at ? new Date(code.used_at).toLocaleDateString() : '-'
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `codigos-resgate-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtrar códigos com base na pesquisa e no status
  const filteredCodes = codes.filter(code => {
    const matchesSearch = code.code.toLowerCase().includes(search.toLowerCase()) ||
                          (code.product_name || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = selectedStatus === 'all' || code.status === selectedStatus;
    
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Códigos de Resgate</h1>
        <div className="flex space-x-2">
          <button 
            onClick={exportCodes}
            disabled={filteredCodes.length === 0}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="mr-2" size={18} /> Exportar
          </button>
          <button 
            onClick={() => fetchRedeemCodes()}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50"
          >
            <RefreshCw className="mr-2" size={18} /> Atualizar
          </button>
          <button 
            onClick={handleAddCode}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            <Plus className="mr-2" size={18} /> Criar Código
          </button>
        </div>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
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
              placeholder="Buscar por código ou produto..."
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
          <option value="available">Disponível</option>
          <option value="expired">Expirado</option>
        </select>
      </div>

      {/* Lista de Códigos */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {isLoading && !isModalOpen ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-gray-500">Carregando códigos...</p>
          </div>
        ) : filteredCodes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Código</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produto</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preço</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredCodes.map((code) => (
                  <tr key={code.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">
                      {code.code}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        code.status === 'available' ? 'bg-green-100 text-green-800' :
                        code.status === 'expired' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {code.status === 'available' ? 'Disponível' :
                        code.status === 'expired' ? 'Expirado' :
                        'Expirado'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {code.product_name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {code.price ? `R$ ${code.price.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div>Criado: {new Date(code.created_at).toLocaleDateString()}</div>
                      {code.used_at && (
                        <div className="text-xs">
                          Usado: {new Date(code.used_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <div className="flex justify-center space-x-2">
                        <button 
                          onClick={() => copyCode(code.code)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Copiar código"
                        >
                          {copiedCode === code.code ? (
                            <Check size={18} />
                          ) : (
                            <Copy size={18} />
                          )}
                        </button>
                        
                        {/* Botão para alternar status (Expirar ou Reativar) */}
                        <button 
                          onClick={() => handleToggleStatus(code)}
                          className={`${
                            code.status === 'available' 
                              ? 'text-red-600 hover:text-red-800' 
                              : 'text-green-600 hover:text-green-800'
                          }`}
                          title={code.status === 'available' ? 'Expirar código' : 'Reativar código'}
                        >
                          {code.status === 'available' ? (
                            <Trash2 size={18} />
                          ) : (
                            <RefreshCw size={18} />
                          )}
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
            <p>Nenhum código de resgate encontrado.</p>
            <p className="text-sm mt-2">
              {search || selectedStatus !== 'all' 
                ? 'Tente ajustar os filtros de busca.' 
                : 'Clique em "Criar Código" para adicionar seu primeiro código de resgate.'}
            </p>
          </div>
        )}
      </div>
      
      {/* Modal de Adicionar Código */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">Criar Código de Resgate</h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Código</label>
                <div className="flex space-x-2">
                  <input 
                    type="text"
                    value={currentCode.code}
                    onChange={(e) => setCurrentCode({
                      ...currentCode, 
                      code: e.target.value.toUpperCase()
                    })}
                    className="flex-1 p-2 border rounded font-mono"
                    placeholder="Digite o código ou use o gerado"
                    // Removida a restrição de tamanho
                  />
                  <button
                    onClick={() => setCurrentCode({
                      ...currentCode,
                      code: generateRandomCode()
                    })}
                    className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
                    title="Gerar novo código"
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  O código pode ter qualquer tamanho.
                </p>
              </div>
              
              {/* Seleção de Produto - NOVA PARTE */}
              <div>
                <label className="block mb-2 font-medium">Produto</label>
                <select
                  value={currentCode.product_id}
                  onChange={(e) => setCurrentCode({
                    ...currentCode,
                    product_id: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                >
                  <option value="">Selecione um produto</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id}>
                      {product.name} - R$ {product.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Status</label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentCode.status === 'available'}
                      onChange={() => setCurrentCode({
                        ...currentCode,
                        status: 'available'
                      })}
                      className="mr-2"
                    />
                    Disponível
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentCode.status === 'expired'}
                      onChange={() => setCurrentCode({
                        ...currentCode,
                        status: 'expired'
                      })}
                      className="mr-2"
                    />
                    Expirado
                  </label>
                </div>
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
                onClick={handleSaveCode}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ajuda */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-medium mb-2 text-blue-800">Como funcionam os códigos de resgate?</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
          <li>Os códigos de resgate podem ser criados manualmente ou gerados automaticamente após um pagamento.</li>
          <li>Cada código é único e está vinculado a um produto específico.</li>
          <li>O cliente recebe o código para resgatar o produto via WhatsApp.</li>
          <li>Quando o código é resgatado, seu status muda para "Expirado".</li>
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

export default RedeemCodes;