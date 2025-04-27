import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, ChevronDown, ChevronUp, PlusCircle, Save, Tag, AlertTriangle } from 'lucide-react';
import { chatbotFlowService } from '../api';

const ChatbotFlows = () => {
  const [flows, setFlows] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [currentFlow, setCurrentFlow] = useState({
    name: '',
    description: '',
    active: true,
    steps: [],
    triggers: []
  });
  const [currentStep, setCurrentStep] = useState({
    step_order: 0,
    message_template: '',
    expected_responses: '',
    action_type: 'message',
    next_flow_id: null
  });
  const [currentTrigger, setCurrentTrigger] = useState({
    keyword: '',
    is_exact_match: false,
    priority: 0
  });
  const [editingStepIndex, setEditingStepIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Buscar fluxos ao carregar
  useEffect(() => {
    fetchFlows();
  }, []);

  // Buscar fluxos da API
  const fetchFlows = async () => {
    setIsLoading(true);
    try {
      const response = await chatbotFlowService.getAll();
      console.log("Fluxos carregados:", response.data);
      setFlows(response.data);
      setError(null);
    } catch (error) {
      console.error('Erro ao buscar fluxos:', error);
      setError('Não foi possível carregar os fluxos do chatbot.');
    }
    setIsLoading(false);
  };

  // Excluir fluxo
  const handleDeleteFlow = async (flowId) => {
    if (!window.confirm('Tem certeza que deseja excluir este fluxo? Esta ação não pode ser desfeita.')) {
      return;
    }
    
    setIsLoading(true);
    try {
      console.log(`Excluindo fluxo ID: ${flowId}`);
      await chatbotFlowService.delete(flowId);
      fetchFlows();
      setError(null);
    } catch (error) {
      console.error('Erro ao excluir fluxo:', error);
      setError('Não foi possível excluir o fluxo. Tente novamente mais tarde.');
    }
    setIsLoading(false);
  };

  // Criar/Atualizar fluxo
  const handleSaveFlow = async () => {
    if (!currentFlow.name) {
      setError('O nome do fluxo é obrigatório.');
      return;
    }

    if (currentFlow.steps.length === 0) {
      setError('O fluxo precisa ter pelo menos um passo.');
      return;
    }

    setIsLoading(true);
    try {
      console.log("Salvando fluxo:", currentFlow);
      
      if (currentFlow.id) {
        // Preparar dados para atualização
        const dataToUpdate = {
          name: currentFlow.name,
          description: currentFlow.description,
          active: currentFlow.active,
          steps: currentFlow.steps
        };
        
        console.log("Atualizando fluxo existente com ID:", currentFlow.id);
        console.log("Dados enviados:", dataToUpdate);
        
        await chatbotFlowService.update(currentFlow.id, dataToUpdate);
        console.log("Fluxo atualizado com sucesso");
      } else {
        // Criar novo fluxo
        console.log("Criando novo fluxo");
        const response = await chatbotFlowService.create(currentFlow);
        console.log("Fluxo criado com sucesso:", response.data);
        
        // Se tiver gatilhos temporários, criar os gatilhos permanentes
        if (currentFlow.triggers && currentFlow.triggers.length > 0 && response.data && response.data.id) {
          const flowId = response.data.id;
          for (const trigger of currentFlow.triggers) {
            if (String(trigger.id).startsWith('temp-')) {
              const { keyword, is_exact_match, priority } = trigger;
              await chatbotFlowService.addTrigger(flowId, { keyword, is_exact_match, priority });
            }
          }
        }
      }
      fetchFlows();
      setIsModalOpen(false);
      setError(null);
    } catch (error) {
      console.error('Erro ao salvar fluxo:', error);
      setError('Não foi possível salvar o fluxo. Verifique os dados e tente novamente.');
    }
    setIsLoading(false);
  };

  // Abrir modal para adicionar/editar fluxo
  const openFlowModal = (flow = null) => {
    setError(null);
    
    if (flow) {
      // Fazer uma cópia profunda do objeto flow para evitar problemas de referência
      const flowCopy = JSON.parse(JSON.stringify(flow));
      
      // Garantir que todos os arrays necessários existam
      flowCopy.steps = flowCopy.steps || [];
      flowCopy.triggers = flowCopy.triggers || [];
      
      console.log("Editando fluxo:", flowCopy);
      setCurrentFlow(flowCopy);
    } else {
      setCurrentFlow({
        name: '',
        description: '',
        active: true,
        steps: [],
        triggers: []
      });
    }
    
    setIsModalOpen(true);
  };

  // Adicionar/editar passo no fluxo
  const handleSaveStep = () => {
    // Validação
    if (!currentStep.message_template) {
      setError('A mensagem do passo é obrigatória.');
      return;
    }

    let updatedSteps = [...currentFlow.steps];
    
    if (editingStepIndex >= 0) {
      // Editar passo existente
      updatedSteps[editingStepIndex] = { ...currentStep };
    } else {
      // Adicionar novo passo
      updatedSteps.push({ 
        ...currentStep, 
        step_order: currentFlow.steps.length + 1 
      });
    }

    // Ordenar passos
    updatedSteps = updatedSteps.map((step, index) => ({
      ...step,
      step_order: index + 1
    }));

    setCurrentFlow({
      ...currentFlow,
      steps: updatedSteps
    });

    setIsStepModalOpen(false);
    setEditingStepIndex(-1);
    setError(null);
  };

  // Abrir modal para adicionar/editar passo
  const openStepModal = (stepIndex = -1) => {
    setError(null);
    if (stepIndex >= 0) {
      setCurrentStep(currentFlow.steps[stepIndex]);
      setEditingStepIndex(stepIndex);
    } else {
      setCurrentStep({
        step_order: currentFlow.steps.length + 1,
        message_template: '',
        expected_responses: '',
        action_type: 'message',
        next_flow_id: null
      });
      setEditingStepIndex(-1);
    }
    setIsStepModalOpen(true);
  };

  // Remover passo
  const handleRemoveStep = (stepIndex) => {
    const updatedSteps = currentFlow.steps.filter((_, index) => index !== stepIndex)
      .map((step, index) => ({
        ...step,
        step_order: index + 1
      }));
    
    setCurrentFlow({
      ...currentFlow,
      steps: updatedSteps
    });
  };

  // Mover passo para cima
  const handleMoveStepUp = (stepIndex) => {
    if (stepIndex === 0) return;
    
    const updatedSteps = [...currentFlow.steps];
    const temp = updatedSteps[stepIndex];
    updatedSteps[stepIndex] = updatedSteps[stepIndex - 1];
    updatedSteps[stepIndex - 1] = temp;

    // Atualizar ordem
    const reorderedSteps = updatedSteps.map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
    
    setCurrentFlow({
      ...currentFlow,
      steps: reorderedSteps
    });
  };

  // Mover passo para baixo
  const handleMoveStepDown = (stepIndex) => {
    if (stepIndex === currentFlow.steps.length - 1) return;
    
    const updatedSteps = [...currentFlow.steps];
    const temp = updatedSteps[stepIndex];
    updatedSteps[stepIndex] = updatedSteps[stepIndex + 1];
    updatedSteps[stepIndex + 1] = temp;

    // Atualizar ordem
    const reorderedSteps = updatedSteps.map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
    
    setCurrentFlow({
      ...currentFlow,
      steps: reorderedSteps
    });
  };

  // Abrir modal para adicionar gatilho (palavra-chave)
  const openTriggerModal = () => {
    setError(null);
    setCurrentTrigger({
      keyword: '',
      is_exact_match: false,
      priority: 0
    });
    setIsTriggerModalOpen(true);
  };

  // Adicionar gatilho (palavra-chave)
  const handleSaveTrigger = async () => {
    // Validação
    if (!currentTrigger.keyword) {
      setError('A palavra-chave é obrigatória.');
      return;
    }

    setIsLoading(true);
    try {
      if (currentFlow.id) {
        // Se o fluxo já existe no banco, adicionar via API
        const response = await chatbotFlowService.addTrigger(currentFlow.id, currentTrigger);
        
        // Atualizar triggers no estado local
        const updatedTriggers = [...(currentFlow.triggers || []), response.data];
        setCurrentFlow({
          ...currentFlow,
          triggers: updatedTriggers
        });
      } else {
        // Se é um novo fluxo, adicionar localmente até salvar o fluxo
        const updatedTriggers = [...(currentFlow.triggers || []), {
          ...currentTrigger,
          id: `temp-${Date.now()}`  // ID temporário
        }];
        setCurrentFlow({
          ...currentFlow,
          triggers: updatedTriggers
        });
      }
      
      setIsTriggerModalOpen(false);
      setError(null);
    } catch (error) {
      console.error('Erro ao salvar gatilho:', error);
      setError('Não foi possível salvar a palavra-chave. Tente novamente.');
    }
    setIsLoading(false);
  };
  
  // Remover gatilho (palavra-chave)
  const handleRemoveTrigger = async (triggerId) => {
    if (!window.confirm('Tem certeza que deseja remover esta palavra-chave?')) {
      return;
    }

    setIsLoading(true);
    try {
      if (currentFlow.id && !String(triggerId).startsWith('temp-')) {
        // Se o fluxo já existe e o gatilho não é temporário, remover via API
        await chatbotFlowService.removeTrigger(currentFlow.id, triggerId);
      }
      
      // Atualizar triggers no estado local
      const updatedTriggers = (currentFlow.triggers || []).filter(t => t.id !== triggerId);
      setCurrentFlow({
        ...currentFlow,
        triggers: updatedTriggers
      });
      
      setError(null);
    } catch (error) {
      console.error('Erro ao remover gatilho:', error);
      setError('Não foi possível remover a palavra-chave. Tente novamente.');
    }
    setIsLoading(false);
  };

  // Tipos de ação disponíveis
  const actionTypes = [
    { value: 'message', label: 'Enviar Mensagem' },
    { value: 'collect_input', label: 'Coletar Resposta' },
    { value: 'show_products', label: 'Mostrar Produtos' },
    { value: 'process_payment', label: 'Processar Pagamento' },
    { value: 'send_code', label: 'Enviar Código' },
    { value: 'redirect', label: 'Redirecionar para Outro Fluxo' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Fluxos de Chatbot</h1>
        <button 
          onClick={() => openFlowModal()}
          className="flex items-center bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          <Plus className="mr-2" /> Adicionar Fluxo
        </button>
      </div>

      {/* Mensagem de Erro Global */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}

      {/* Lista de Fluxos */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {flows.length > 0 ? (
          <div className="divide-y">
            {flows.map((flow) => (
              <div 
                key={flow.id} 
                className="p-4 hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center">
                      <h2 className="text-lg font-semibold">{flow.name}</h2>
                      <span 
                        className={`ml-2 px-2 py-1 text-xs rounded ${
                          flow.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {flow.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm">{flow.description}</p>
                    <div className="flex mt-2 flex-wrap gap-1">
                      <span className="text-gray-500 text-xs">
                        {flow.steps_count || 0} passos
                      </span>
                      {flow.triggers && flow.triggers.length > 0 && (
                        <div className="flex items-center ml-4">
                          <Tag size={14} className="text-blue-500 mr-1" />
                          <span className="text-gray-500 text-xs">
                            {flow.triggers.length} palavras-chave
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Palavras-chave */}
                    {flow.triggers && flow.triggers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {flow.triggers.map(trigger => (
                          <span 
                            key={trigger.id} 
                            className={`text-xs px-2 py-1 rounded ${
                              trigger.is_exact_match 
                                ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}
                            title={`Prioridade: ${trigger.priority}`}
                          >
                            {trigger.keyword}
                            {trigger.is_exact_match && " (exato)"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <button 
                      onClick={() => openFlowModal(flow)}
                      className="text-blue-600 hover:text-blue-800 p-1"
                      title="Editar fluxo"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteFlow(flow.id)}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Excluir fluxo"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <p>Nenhum fluxo de chatbot cadastrado.</p>
            <p className="text-sm mt-2">
              Clique em "Adicionar Fluxo" para criar o primeiro fluxo.
            </p>
          </div>
        )}
      </div>

      {/* Modal de Fluxo */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">
              {currentFlow.id ? 'Editar Fluxo' : 'Novo Fluxo'}
            </h2>
            
            {/* Configurações Básicas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Nome do Fluxo</label>
                <input 
                  type="text"
                  value={currentFlow.name}
                  onChange={(e) => setCurrentFlow({
                    ...currentFlow, 
                    name: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Ex: Boas-vindas"
                />
              </div>
              
              <div>
                <label className="block mb-2 font-medium">Status</label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={currentFlow.active}
                      onChange={() => setCurrentFlow({
                        ...currentFlow,
                        active: true
                      })}
                      className="mr-2"
                    />
                    Ativo
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="radio"
                      checked={!currentFlow.active}
                      onChange={() => setCurrentFlow({
                        ...currentFlow,
                        active: false
                      })}
                      className="mr-2"
                    />
                    Inativo
                  </label>
                </div>
              </div>
              
              <div className="md:col-span-2">
                <label className="block mb-2 font-medium">Descrição</label>
                <textarea 
                  value={currentFlow.description}
                  onChange={(e) => setCurrentFlow({
                    ...currentFlow, 
                    description: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Descreva brevemente o propósito deste fluxo"
                  rows={2}
                />
              </div>
            </div>
            
            {/* Palavras-chave/Gatilhos */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium flex items-center">
                  <Tag size={18} className="mr-2" /> Palavras-chave
                </h3>
                <button 
                  onClick={openTriggerModal}
                  className="flex items-center text-blue-600 px-3 py-1 rounded border border-blue-600 hover:bg-blue-50"
                >
                  <PlusCircle size={16} className="mr-1" /> Adicionar Palavra-chave
                </button>
              </div>
              
              {currentFlow.triggers && currentFlow.triggers.length > 0 ? (
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    As palavras-chave determinam quando este fluxo será ativado baseado na mensagem do usuário.
                  </p>
                  <div className="bg-gray-50 border rounded p-4">
                    <div className="flex flex-wrap gap-2">
                      {currentFlow.triggers.map(trigger => (
                        <div 
                          key={trigger.id} 
                          className={`flex items-center px-3 py-1 rounded ${
                            trigger.is_exact_match 
                              ? 'bg-purple-100 border border-purple-200' 
                              : 'bg-blue-100 border border-blue-200'
                          }`}
                        >
                          <span className="text-sm font-medium mr-2">
                            {trigger.keyword}
                          </span>
                          {trigger.is_exact_match && (
                            <span className="text-xs bg-purple-200 px-1 rounded mr-1">
                              exato
                            </span>
                          )}
                          <span className="text-xs bg-gray-200 px-1 rounded mr-2">
                            p:{trigger.priority}
                          </span>
                          <button 
                            onClick={() => handleRemoveTrigger(trigger.id)}
                            className="text-gray-500 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 border rounded border-dashed text-center text-gray-500 mb-4">
                  <p>Nenhuma palavra-chave configurada.</p>
                  <p className="text-sm mt-1">
                    Adicione palavras-chave para determinar quando este fluxo será ativado.
                  </p>
                </div>
              )}
            </div>
            
            {/* Passos do Fluxo */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">Passos do Fluxo</h3>
                <button 
                  onClick={() => openStepModal()}
                  className="flex items-center text-blue-600 px-3 py-1 rounded border border-blue-600 hover:bg-blue-50"
                >
                  <PlusCircle size={16} className="mr-1" /> Adicionar Passo
                </button>
              </div>
              
              {currentFlow.steps.length > 0 ? (
                <div className="space-y-4">
                  {currentFlow.steps.map((step, index) => (
                    <div key={index} className="border rounded p-4 bg-gray-50">
                      <div className="flex justify-between items-start">
                        <h4 className="font-medium">
                          Passo {step.step_order}: {actionTypes.find(t => t.value === step.action_type)?.label || step.action_type}
                        </h4>
                        <div className="flex space-x-1">
                          <button 
                            onClick={() => handleMoveStepUp(index)}
                            disabled={index === 0}
                            className="text-gray-600 hover:text-gray-800 disabled:opacity-30"
                          >
                            <ChevronUp size={18} />
                          </button>
                          <button 
                            onClick={() => handleMoveStepDown(index)}
                            disabled={index === currentFlow.steps.length - 1}
                            className="text-gray-600 hover:text-gray-800 disabled:opacity-30"
                          >
                            <ChevronDown size={18} />
                          </button>
                          <button 
                            onClick={() => openStepModal(index)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit size={18} />
                          </button>
                          <button 
                            onClick={() => handleRemoveStep(index)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm mt-2 text-gray-600">
                        {step.message_template}
                      </p>
                      {step.expected_responses && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-500">Respostas esperadas:</p>
                          <p className="text-sm text-gray-600">{step.expected_responses}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-6 border rounded border-dashed text-gray-500">
                  <p>Nenhum passo configurado.</p>
                  <p className="text-sm mt-1">
                    Adicione passos para definir o fluxo de conversação.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border rounded hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveFlow}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <Save size={18} className="mr-2" /> Salvar Fluxo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Passo */}
      {isStepModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-2xl">
            <h2 className="text-xl font-bold mb-4">
              {editingStepIndex >= 0 ? `Editar Passo ${editingStepIndex + 1}` : 'Novo Passo'}
            </h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block mb-2 font-medium">Tipo de Ação</label>
                <select
                  value={currentStep.action_type}
                  onChange={(e) => setCurrentStep({
                    ...currentStep,
                    action_type: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                >
                  {actionTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block mb-2 font-medium">
                  {currentStep.action_type === 'collect_input' ? 'Pergunta' : 'Mensagem'}
                </label>
                <textarea 
                  value={currentStep.message_template}
                  onChange={(e) => setCurrentStep({
                    ...currentStep,
                    message_template: e.target.value
                  })}
                  className="w-full p-2 border rounded"
                  placeholder="Digite a mensagem que será enviada"
                  rows={3}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Você pode usar variáveis como {"{nome}"} que serão substituídas durante a conversa.
                </p>
              </div>
              
              {currentStep.action_type === 'collect_input' && (
                <div>
                  <label className="block mb-2 font-medium">Respostas Esperadas</label>
                  <textarea 
                    value={currentStep.expected_responses}
                    onChange={(e) => setCurrentStep({
                      ...currentStep,
                      expected_responses: e.target.value
                    })}
                    className="w-full p-2 border rounded"
                    placeholder="Ex: sim, não, talvez"
                    rows={2}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Separe as possíveis respostas por vírgulas. Deixe em branco para aceitar qualquer resposta.
                  </p>
                </div>
              )}
              
              {currentStep.action_type === 'redirect' && (
                <div>
                <label className="block mb-2 font-medium">Próximo Fluxo</label>
                <select
                  value={currentStep.next_flow_id || ''}
                  onChange={(e) => setCurrentStep({
                    ...currentStep,
                    next_flow_id: e.target.value ? parseInt(e.target.value) : null
                  })}
                  className="w-full p-2 border rounded"
                >
                  <option value="">Selecione um fluxo</option>
                  {flows.filter(f => f.id !== currentFlow.id).map(flow => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          
          <div className="flex justify-end space-x-3">
            <button 
              onClick={() => setIsStepModalOpen(false)}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button 
              onClick={handleSaveStep}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal de Palavra-chave */}
    {isTriggerModalOpen && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-lg w-full max-w-lg">
          <h2 className="text-xl font-bold mb-4">
            Adicionar Palavra-chave
          </h2>
          
          <div className="space-y-4 mb-6">
            <div>
              <label className="block mb-2 font-medium">Palavra-chave</label>
              <input 
                type="text"
                value={currentTrigger.keyword}
                onChange={(e) => setCurrentTrigger({
                  ...currentTrigger, 
                  keyword: e.target.value
                })}
                className="w-full p-2 border rounded"
                placeholder="Ex: ajuda, produtos, comprar"
              />
              <p className="text-xs text-gray-500 mt-1">
                Esta palavra-chave ativará o fluxo quando o usuário a enviar.
              </p>
            </div>
            
            <div>
              <label className="flex items-center">
                <input 
                  type="checkbox"
                  checked={currentTrigger.is_exact_match}
                  onChange={(e) => setCurrentTrigger({
                    ...currentTrigger,
                    is_exact_match: e.target.checked
                  })}
                  className="mr-2 h-4 w-4"
                />
                <span>Correspondência exata</span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">
                Se ativado, a mensagem do usuário deve ser exatamente igual à palavra-chave.
                Se desativado, a palavra-chave só precisa estar contida na mensagem.
              </p>
            </div>
            
            <div>
              <label className="block mb-2 font-medium">Prioridade</label>
              <input 
                type="number"
                value={currentTrigger.priority}
                onChange={(e) => setCurrentTrigger({
                  ...currentTrigger, 
                  priority: parseInt(e.target.value)
                })}
                className="w-full p-2 border rounded"
                min="0"
                step="1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Número que define a prioridade. Valor maior tem prioridade maior em caso de múltiplas correspondências.
              </p>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="flex items-start">
                <AlertTriangle size={16} className="text-yellow-600 mt-0.5 mr-2 flex-shrink-0" />
                <p className="text-sm text-yellow-800">
                  Certifique-se de que suas palavras-chave não entrem em conflito entre diferentes fluxos.
                  Palavras-chave com maior prioridade serão consideradas primeiro.
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button 
              onClick={() => setIsTriggerModalOpen(false)}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button 
              onClick={handleSaveTrigger}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Adicionar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Estado de Carregamento */}
    {isLoading && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
      </div>
    )}
    
    {/* Ajuda */}
    <div className="bg-blue-50 p-4 rounded-lg mt-6">
      <h3 className="font-medium mb-2 text-blue-800">Como funcionam os fluxos de chatbot?</h3>
      <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
        <li>Os <strong>fluxos de chatbot</strong> definem sequências de mensagens e interações para seus clientes.</li>
        <li>Cada fluxo é ativado por <strong>palavras-chave</strong> que o cliente envia para o WhatsApp.</li>
        <li>Fluxos com palavras-chave de <strong>maior prioridade</strong> serão ativados primeiro em caso de múltiplas correspondências.</li>
        <li>Os <strong>passos</strong> definem a ordem das mensagens e ações que serão executadas em um fluxo.</li>
        <li>O chatbot pode <strong>coletar informações</strong> do cliente e usar essas informações em mensagens futuras.</li>
        <li>Você pode <strong>encadear fluxos</strong> para criar conversas mais complexas.</li>
      </ul>
    </div>
  </div>
);
};

export default ChatbotFlows;