import React, { useState, useEffect } from 'react';
import { dashboardService } from '../api';
import { Users, ShoppingCart, DollarSign, BarChart } from 'lucide-react';

const Dashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    total_users: 0,
    total_transactions: 0,
    total_revenue: 0,
    top_products: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Buscar dados do dashboard quando o componente carregar
    const fetchDashboardData = async () => {
      try {
        setIsLoading(true);
        console.log('Buscando dados do dashboard...');
        const response = await dashboardService.getData();
        console.log('Dados recebidos:', response.data);
        setDashboardData(response.data);
        setError(null);
      } catch (err) {
        console.error('Erro ao buscar dados do dashboard:', err);
        setError('Não foi possível carregar os dados do dashboard. Verifique a conexão com o backend.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();

    // Atualizar a cada 60 segundos
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Tratamento de estado de carregamento
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  // Tratamento de erro
  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong className="font-bold">Erro!</strong>
        <span className="block sm:inline"> {error}</span>
        <button 
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-4"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      
      {/* Cards de métricas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center">
          <div className="rounded-full bg-blue-100 p-3 mr-4">
            <Users className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total de Usuários</p>
            <p className="text-2xl font-bold">{dashboardData.total_users}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center">
          <div className="rounded-full bg-green-100 p-3 mr-4">
            <ShoppingCart className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Total de Transações</p>
            <p className="text-2xl font-bold">{dashboardData.total_transactions}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center">
          <div className="rounded-full bg-purple-100 p-3 mr-4">
            <DollarSign className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Receita Total</p>
            <p className="text-2xl font-bold">R$ {dashboardData.total_revenue.toFixed(2)}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center">
          <div className="rounded-full bg-orange-100 p-3 mr-4">
            <BarChart className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Conversão</p>
            <p className="text-2xl font-bold">
              {dashboardData.total_users ? 
                ((dashboardData.total_transactions / dashboardData.total_users) * 100).toFixed(1) : 0}%
            </p>
          </div>
        </div>
      </div>
      
      {/* Produtos mais vendidos */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Produtos Mais Vendidos</h2>
        {dashboardData.top_products.length > 0 ? (
          <div className="space-y-4">
            {dashboardData.top_products.map((product, index) => (
              <div key={index} className="flex items-center">
                <div className="w-full bg-gray-200 rounded-full h-4">
                  <div 
                    className="bg-blue-600 h-4 rounded-full" 
                    style={{ 
                      width: `${Math.max(
                        10, 
                        (product.sales / Math.max(...dashboardData.top_products.map(p => p.sales))) * 100
                      )}%` 
                    }}
                  ></div>
                </div>
                <p className="ml-4 w-40 font-medium">{product.name}</p>
                <p className="ml-auto font-bold">{product.sales} vendas</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">Nenhum produto vendido ainda.</p>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
