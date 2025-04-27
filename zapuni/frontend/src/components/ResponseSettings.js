import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { whatsappService } from '../api'; // Importando do módulo de API existente

const ResponseSettings = () => {
  const [settings, setSettings] = useState({
    respond_to_groups: true,
    respond_to_unsaved_contacts: true,
    respond_to_saved_contacts: true,
    respond_only_with_keyword: false,
    name_keyword: '',
    active: true
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showInfoToolTip, setShowInfoToolTip] = useState(false);

  // Buscar configurações existentes ao carregar
  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const response = await whatsappService.getResponseSettings();
      if (response && response.data) {
        setSettings(response.data);
      }
      setError(null);
    } catch (err) {
      console.error('Erro ao buscar configurações:', err);
      setError('Não foi possível carregar as configurações. Verifique a conexão com o backend.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleChange = (setting) => {
    setSettings(prev => ({
      ...prev,
      [setting]: !prev[setting]
    }));
  };

  const handleKeywordChange = (e) => {
    setSettings(prev => ({
      ...prev,
      name_keyword: e.target.value
    }));
  };

  const handleSaveSettings = async () => {
    setIsLoading(true);
    setSaveSuccess(false);
    try {
      await whatsappService.saveResponseSettings(settings);
      setError(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
      setError('Não foi possível salvar as configurações. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleInfoTooltip = () => {
    setShowInfoToolTip(!showInfoToolTip);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Configurações de Resposta</h1>
        <div className="flex space-x-2">
          <button 
            onClick={fetchSettings}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50"
            disabled={isLoading}
          >
            <RefreshCw className="mr-2" size={18} /> Atualizar
          </button>
          <button 
            onClick={handleSaveSettings}
            className={`flex items-center px-4 py-2 rounded ${
              saveSuccess ? 'bg-green-600' : 'bg-blue-600'
            } text-white hover:${
              saveSuccess ? 'bg-green-700' : 'bg-blue-700'
            }`}
            disabled={isLoading}
          >
            <Save className="mr-2" size={18} /> 
            {saveSuccess ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}

      {/* Configurações Principais */}
      <div className="bg-white shadow-md rounded-lg p-6">
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-4">Ativar/Desativar Respostas</h2>
          <div className="flex items-center mb-2">
            <div className="mr-4">
              <label className="inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer"
                  checked={settings.active}
                  onChange={() => handleToggleChange('active')}
                />
                <div className={`relative w-11 h-6 rounded-full peer ${
                  settings.active ? 'bg-green-500' : 'bg-gray-300'
                } peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 transition-colors`}>
                  <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-all ${
                    settings.active ? 'translate-x-5 border-white' : ''
                  }`}></div>
                </div>
                <span className="ml-3 text-sm font-medium">
                  Ativar respostas automáticas
                </span>
              </label>
            </div>
          </div>
          {!settings.active && (
            <div className="p-3 bg-yellow-50 text-yellow-800 text-sm rounded-md flex items-start mt-2">
              <AlertTriangle className="mr-2 flex-shrink-0 mt-0.5" size={16} />
              <span>O chatbot não responderá a nenhuma mensagem enquanto estiver desativado.</span>
            </div>
          )}
        </div>

        <h2 className="text-lg font-medium mb-4">Configurações de Resposta</h2>
        <div className="space-y-4">
          {/* Responder a Grupos */}
          <div className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
            <span>Responder em grupos</span>
            <label className="inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.respond_to_groups}
                onChange={() => handleToggleChange('respond_to_groups')}
                disabled={!settings.active}
              />
              <div className={`relative w-11 h-6 rounded-full peer ${
                settings.respond_to_groups && settings.active ? 'bg-blue-500' : 'bg-gray-300'
              } peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 transition-colors`}>
                <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-all ${
                  settings.respond_to_groups && settings.active ? 'translate-x-5 border-white' : ''
                }`}></div>
              </div>
            </label>
          </div>
          
          {/* Responder a Contatos Não Salvos */}
          <div className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
            <span>Responder a contatos não salvos</span>
            <label className="inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.respond_to_unsaved_contacts}
                onChange={() => handleToggleChange('respond_to_unsaved_contacts')}
                disabled={!settings.active}
              />
              <div className={`relative w-11 h-6 rounded-full peer ${
                settings.respond_to_unsaved_contacts && settings.active ? 'bg-red-500' : 'bg-gray-300'
              } peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 transition-colors`}>
                <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-all ${
                  settings.respond_to_unsaved_contacts && settings.active ? 'translate-x-5 border-white' : ''
                }`}></div>
              </div>
            </label>
          </div>
          
          {/* Responder a Contatos Salvos */}
          <div className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
            <span>Responder a contatos salvos</span>
            <label className="inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.respond_to_saved_contacts}
                onChange={() => handleToggleChange('respond_to_saved_contacts')}
                disabled={!settings.active}
              />
              <div className={`relative w-11 h-6 rounded-full peer ${
                settings.respond_to_saved_contacts && settings.active ? 'bg-green-500' : 'bg-gray-300'
              } peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 transition-colors`}>
                <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-all ${
                  settings.respond_to_saved_contacts && settings.active ? 'translate-x-5 border-white' : ''
                }`}></div>
              </div>
            </label>
          </div>
          
          {/* Configuração de Palavra-chave */}
          <div className="p-3 border rounded hover:bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <span>Responder apenas com palavra-chave no nome do WhatsApp</span>
                <div className="relative ml-2">
                  <Info 
                    size={16} 
                    className="text-blue-500 cursor-pointer" 
                    onClick={toggleInfoTooltip}
                  />
                  {showInfoToolTip && (
                    <div className="absolute z-10 w-64 bg-blue-800 text-white p-2 rounded shadow-lg text-xs -right-2 top-6">
                      Esta configuração verifica o nome como salvo na agenda do WhatsApp conectado, 
                      não o nome do cliente no sistema. Só responderá a contatos que tenham a palavra-chave no nome.
                      <div className="absolute -top-1 right-2 w-2 h-2 bg-blue-800 transform rotate-45"></div>
                    </div>
                  )}
                </div>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer"
                  checked={settings.respond_only_with_keyword}
                  onChange={() => handleToggleChange('respond_only_with_keyword')}
                  disabled={!settings.active || !settings.respond_to_saved_contacts}
                />
                <div className={`relative w-11 h-6 rounded-full peer ${
                  settings.respond_only_with_keyword && settings.active && settings.respond_to_saved_contacts ? 'bg-blue-500' : 'bg-gray-300'
                } peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 transition-colors`}>
                  <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-all ${
                    settings.respond_only_with_keyword && settings.active && settings.respond_to_saved_contacts ? 'translate-x-5 border-white' : ''
                  }`}></div>
                </div>
              </label>
            </div>
            {settings.respond_only_with_keyword && settings.active && settings.respond_to_saved_contacts && (
              <div className="mt-2">
                <input
                  type="text"
                  value={settings.name_keyword}
                  onChange={handleKeywordChange}
                  placeholder="Ex: unitv, cliente, vip, etc."
                  className="w-full p-2 border rounded"
                />
                <p className="text-sm text-gray-500 mt-1">
                  O chatbot responderá apenas a contatos salvos no WhatsApp que tenham esta palavra no nome.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Informações e Dicas */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-medium mb-2 text-blue-800">Como funcionam as configurações de resposta?</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
          <li>Configure a quem o chatbot deve responder combinando diferentes opções.</li>
          <li>Você pode escolher responder ou não em grupos de WhatsApp.</li>
          <li>Defina se o bot responde a contatos não salvos na agenda.</li>
          <li>Configure para responder apenas a contatos que possuam uma palavra específica no nome (ex: "unitv").</li>
          <li><strong>IMPORTANTE:</strong> A verificação da palavra-chave é feita diretamente na agenda do WhatsApp conectado.</li>
          <li>As configurações entram em vigor imediatamente após salvas.</li>
        </ul>
      </div>

      {/* Estado de Carregamento */}
      {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
};

export default ResponseSettings;
