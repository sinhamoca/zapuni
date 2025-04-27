import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Home, Package, MessageCircle, QrCode, Settings, Users, Filter, MessageSquare } from 'lucide-react';

// Importar páginas
import Dashboard from './pages/Dashboard';
import ProductManagement from './pages/ProductManagement';
import ChatbotFlows from './pages/ChatbotFlows';
import RedeemCodes from './pages/RedeemCodes';
import WhatsappSettings from './pages/WhatsappSettings';
import SubscriptionManagement from './pages/SubscriptionManagement';
import ResponseSettings from './pages/ResponseSettings'; 
import MassMessaging from './pages/MassMessaging'; // Nova importação para envio de mensagens em massa

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-gray-100">
        {/* Sidebar de Navegação */}
        <div className="w-64 bg-white shadow-md">
          <div className="p-6 text-center bg-blue-600 text-white">
            <h1 className="text-2xl font-bold">Chatbot Admin</h1>
          </div>
          <nav className="mt-10">
            <Link 
              to="/" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <Home className="mr-3" /> Dashboard
            </Link>
            <Link 
              to="/produtos" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <Package className="mr-3" /> Produtos
            </Link>
            <Link 
              to="/fluxos-chatbot" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <MessageCircle className="mr-3" /> Fluxos de Chatbot
            </Link>
            <Link 
              to="/codigos-resgate" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <QrCode className="mr-3" /> Códigos de Resgate
            </Link>
            {/* Assinaturas */}
            <Link 
              to="/assinaturas" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <Users className="mr-3" /> Assinaturas
            </Link>
            {/* Nova rota para envio de mensagens em massa */}
            <Link 
              to="/enviar-mensagens" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <MessageSquare className="mr-3" /> Enviar Mensagens
            </Link>
            {/* Configurações de resposta */}
            <Link 
              to="/configuracoes-resposta" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <Filter className="mr-3" /> Config. de Resposta
            </Link>
            <Link 
              to="/configuracoes" 
              className="flex items-center py-4 px-6 text-gray-700 hover:bg-blue-100 hover:text-blue-600"
            >
              <Settings className="mr-3" /> Configurações
            </Link>
          </nav>
        </div>

        {/* Área de Conteúdo Principal */}
        <div className="flex-1 overflow-y-auto p-10">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/produtos" element={<ProductManagement />} />
            <Route path="/fluxos-chatbot" element={<ChatbotFlows />} />
            <Route path="/codigos-resgate" element={<RedeemCodes />} />
            <Route path="/assinaturas" element={<SubscriptionManagement />} />
            <Route path="/enviar-mensagens" element={<MassMessaging />} /> {/* Nova rota para envio de mensagens */}
            <Route path="/configuracoes-resposta" element={<ResponseSettings />} />
            <Route path="/configuracoes" element={<WhatsappSettings />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
