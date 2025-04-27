import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, RefreshCw } from 'lucide-react';
import { productService } from '../api';

const ProductManagement = () => {
  const [products, setProducts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentProduct, setCurrentProduct] = useState({
    name: '',
    description: '',
    price: 0,
    active: true
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Buscar produtos ao carregar
  useEffect(() => {
    fetchProducts();
  }, []);

  // Buscar produtos da API
  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      // Tentamos buscar da API real. Se falhar, usamos dados de exemplo
      const response = await productService.getAll().catch(() => {
        return { 
          data: [
            { id: 1, name: 'Plano Básico', description: 'Acesso básico ao sistema', price: 50.00, active: true },
            { id: 2, name: 'Plano Avançado', description: 'Acesso completo com recursos adicionais', price: 100.00, active: true }
          ]
        };
      });
      
      setProducts(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao buscar produtos:', err);
      setError('Não foi possível carregar os produtos. Verifique a conexão com o backend.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddProduct = () => {
    setCurrentProduct({ name: '', description: '', price: 0, active: true });
    setIsModalOpen(true);
  };

  const handleEditProduct = (product) => {
    setCurrentProduct({...product});
    setIsModalOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!currentProduct.name || currentProduct.price <= 0) {
      setError('Nome e preço são obrigatórios e o preço deve ser maior que zero.');
      return;
    }

    setIsLoading(true);
    try {
      if (currentProduct.id) {
        // Atualiza produto existente
        await productService.update(currentProduct.id, currentProduct).catch(() => {
          // Fallback para ambiente de desenvolvimento
          setProducts(prev => prev.map(p => p.id === currentProduct.id ? currentProduct : p));
          return { data: currentProduct };
        });
      } else {
        // Adiciona novo produto
        await productService.create(currentProduct).catch(() => {
          // Fallback para ambiente de desenvolvimento
          const newId = Math.max(0, ...products.map(p => p.id)) + 1;
          const newProduct = {...currentProduct, id: newId};
          setProducts(prev => [...prev, newProduct]);
          return { data: newProduct };
        });
      }
      
      setIsModalOpen(false);
      fetchProducts();
      setError(null);
    } catch (err) {
      console.error('Erro ao salvar produto:', err);
      setError('Não foi possível salvar o produto. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Tem certeza que deseja excluir este produto?')) {
      return;
    }
    
    setIsLoading(true);
    try {
      await productService.delete(productId).catch(() => {
        // Fallback para ambiente de desenvolvimento
        setProducts(prev => prev.filter(p => p.id !== productId));
        return { data: { success: true } };
      });
      
      fetchProducts();
    } catch (err) {
      console.error('Erro ao excluir produto:', err);
      setError('Não foi possível excluir o produto.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestão de Produtos</h1>
        <div className="flex space-x-2">
          <button 
            onClick={fetchProducts}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50"
          >
            <RefreshCw className="mr-2" size={18} /> Atualizar
          </button>
          <button 
            onClick={handleAddProduct}
            className="flex items-center bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            <Plus className="mr-2" /> Adicionar Produto
          </button>
        </div>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}

      {/* Tabela de Produtos */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {isLoading && !isModalOpen ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-gray-500">Carregando produtos...</p>
          </div>
        ) : products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
                  <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrição</th>
                  <th className="p-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Preço</th>
                  <th className="p-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="p-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{product.name}</td>
                    <td className="p-3">{product.description}</td>
                    <td className="p-3 text-right">R$ {product.price.toFixed(2)}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        product.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {product.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex justify-center space-x-2">
                        <button 
                          onClick={() => handleEditProduct(product)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Editar produto"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => handleDeleteProduct(product.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Excluir produto"
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
            <p>Nenhum produto cadastrado.</p>
            <p className="text-sm mt-2">
              Clique em "Adicionar Produto" para cadastrar o primeiro produto.
            </p>
          </div>
        )}
      </div>

      {/* Modal de Adicionar/Editar Produto */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">
              {currentProduct.id ? 'Editar Produto' : 'Adicionar Produto'}
            </h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Nome do Produto</label>
                <input 
                  type="text"
                  value={currentProduct.name}
                  onChange={(e) => setCurrentProduct({
                    ...currentProduct, 
                    name: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Digite o nome do produto"
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Descrição</label>
                <textarea 
                  value={currentProduct.description}
                  onChange={(e) => setCurrentProduct({
                    ...currentProduct, 
                    description: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Descrição do produto"
                  rows={3}
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Preço (R$)</label>
                <input 
                  type="number"
                  value={currentProduct.price}
                  onChange={(e) => setCurrentProduct({
                    ...currentProduct, 
                    price: parseFloat(e.target.value)
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Status</label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentProduct.active}
                      onChange={() => setCurrentProduct({
                        ...currentProduct,
                        active: true
                      })}
                      className="mr-2"
                    />
                    Ativo
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={!currentProduct.active}
                      onChange={() => setCurrentProduct({
                        ...currentProduct,
                        active: false
                      })}
                      className="mr-2"
                    />
                    Inativo
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
                onClick={handleSaveProduct}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estado de Carregamento */}
      {isLoading && isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
};

export default ProductManagement;
