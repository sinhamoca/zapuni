import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Image, AlertCircle, Users, Clock, RefreshCw, 
  CheckCircle, XCircle, Info, Calendar, Download, Trash2
} from 'lucide-react';
import { massMessagingService } from '../api';

const MassMessaging = () => {
  // Estados para formulário
  const [segment, setSegment] = useState('active');
  const [message, setMessage] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [delaySeconds, setDelaySeconds] = useState(3);
  const [daysThreshold, setDaysThreshold] = useState(null);
  
  // Estados para estatísticas
  const [stats, setStats] = useState({
    active: 0,
    expired: 0,
    expiring_soon: 0,
    total: 0,
  });
  
  // Estados para envio e status
  const [isSending, setIsSending] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [history, setHistory] = useState([]);
  
  // Refs
  const fileInputRef = useRef(null);
  const statusIntervalRef = useRef(null);
  const logContainerRef = useRef(null);
  
  // Estados para controle de UI
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  // Carregar estatísticas de segmentos ao iniciar
  useEffect(() => {
    fetchSegmentStats();
    fetchHistory();
  }, []);
  
  // Limpar intervalos ao desmontar o componente
  useEffect(() => {
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, []);
  
  // Monitorar status da tarefa atual
  useEffect(() => {
    if (currentTask) {
      // Verificar status imediatamente
      checkTaskStatus();
      
      // Configurar verificação periódica
      statusIntervalRef.current = setInterval(() => {
        checkTaskStatus();
      }, 3000); // Verificar a cada 3 segundos
      
      return () => {
        clearInterval(statusIntervalRef.current);
      };
    }
  }, [currentTask]);
  
  // Efeito para preview de imagem
  useEffect(() => {
    if (selectedImage) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(selectedImage);
    } else {
      setImagePreview(null);
    }
  }, [selectedImage]);
  
  // Auto-scroll para os logs mais recentes
  useEffect(() => {
    if (logContainerRef.current && taskStatus?.logs?.length > 0) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [taskStatus?.logs]);
  
  // Função para buscar estatísticas de segmentos
  const fetchSegmentStats = async () => {
    try {
      const response = await massMessagingService.getSegments();
      setStats(response.data);
    } catch (err) {
      console.error('Erro ao buscar estatísticas de segmentos:', err);
      setError('Não foi possível carregar as estatísticas de segmentos.');
    }
  };
  
  // Função para buscar histórico de envios
  const fetchHistory = async () => {
    try {
      const response = await massMessagingService.getHistory();
      setHistory(response.data);
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
    }
  };
  
  // Função para verificar status da tarefa atual
  const checkTaskStatus = async () => {
    if (!currentTask) return;
    
    try {
      const response = await massMessagingService.getStatus(currentTask);
      setTaskStatus(response.data);
      
      // Se a tarefa foi concluída, parar de verificar
      if (response.data.status === 'completed' || response.data.status === 'failed') {
        clearInterval(statusIntervalRef.current);
        
        // Atualizar histórico
        setTimeout(() => {
          fetchHistory();
          fetchSegmentStats();
        }, 1000);
        
        // Se concluído com sucesso, mostrar mensagem
        if (response.data.status === 'completed') {
          setSuccess(`Envio concluído! ${response.data.successful} mensagens enviadas com sucesso de ${response.data.total_recipients}.`);
        }
        
        // Limpar estado de envio após 5 segundos
        setTimeout(() => {
          setIsSending(false);
        }, 5000);
      }
    } catch (err) {
      console.error('Erro ao verificar status da tarefa:', err);
    }
  };
  
  // Função para lidar com upload de imagem
  const handleImageChange = (e) => {
    if (e.target.files[0]) {
      setSelectedImage(e.target.files[0]);
    }
  };
  
  // Função para remover imagem selecionada
  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  // Função para enviar mensagem
  const handleSendMessage = async () => {
    // Validar formulário
    if (!message.trim()) {
      setError('A mensagem não pode estar vazia.');
      return;
    }
    
    setIsSending(true);
    setError(null);
    setSuccess(null);
    
    try {
      let imageId = null;
      
      // Se tiver uma imagem, fazer upload primeiro
      if (selectedImage) {
        const formData = new FormData();
        formData.append('file', selectedImage);
        
        const imageResponse = await massMessagingService.uploadImage(formData);
        
        imageId = imageResponse.data.image_id;
      }
      
      // Preparar dados para envio
      const payload = {
        segment,
        message,
        image_id: imageId,
        delay_seconds: delaySeconds,
        days_threshold: segment === 'active' ? daysThreshold : null
      };
      
      // Enviar requisição
      const response = await massMessagingService.sendMassMessage(payload);
      
      // Armazenar ID da tarefa para monitoramento
      setCurrentTask(response.data.task_id);
      
    } catch (err) {
      console.error('Erro ao enviar mensagem em massa:', err);
      setError('Não foi possível iniciar o envio de mensagens. Verifique a conexão do WhatsApp.');
      setIsSending(false);
    }
  };
  
  // Função para mostrar preview
  const showPreview = () => {
    setIsPreviewOpen(true);
  };
  
  // Função para formatar data
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
  };
  
  // Renderizar status da tarefa como texto
  const renderTaskStatusText = (status) => {
    switch (status) {
      case 'preparing':
        return 'Preparando';
      case 'in_progress':
        return 'Em Progresso';
      case 'completed':
        return 'Concluído';
      case 'failed':
        return 'Falhou';
      default:
        return status;
    }
  };
  
  // Renderizar status da tarefa como cor
  const renderTaskStatusColor = (status) => {
    switch (status) {
      case 'preparing':
        return 'bg-blue-100 text-blue-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  
  // Renderizar logs
  const renderLogs = () => {
    if (!taskStatus || !taskStatus.logs || taskStatus.logs.length === 0) {
      return <p className="text-gray-500 text-center">Nenhum log disponível</p>;
    }
    
    return (
      <div ref={logContainerRef} className="h-64 overflow-y-auto bg-gray-50 p-2 rounded text-sm">
        {taskStatus.logs.map((log, idx) => (
          <div key={idx} className="py-1 border-b border-gray-100">
            <span className="text-xs text-gray-500">{formatDate(log.time)}</span> - 
            <span className="ml-2">{log.message}</span>
          </div>
        ))}
      </div>
    );
  };
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Envio de Mensagens em Massa</h1>
        <div className="flex space-x-2">
          <button 
            onClick={() => { fetchSegmentStats(); fetchHistory(); }}
            className="flex items-center px-3 py-2 border rounded hover:bg-gray-50"
          >
            <RefreshCw className="mr-2" size={18} /> Atualizar
          </button>
        </div>
      </div>

      {/* Mensagem de Erro */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}
      
      {/* Mensagem de Sucesso */}
      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative">
          {success}
        </div>
      )}
      
      {/* Estatísticas de Segmentos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="rounded-full bg-blue-100 p-3 mr-4">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Clientes Ativos</p>
              <p className="text-2xl font-bold">{stats.active}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="rounded-full bg-red-100 p-3 mr-4">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Clientes Expirados</p>
              <p className="text-2xl font-bold">{stats.expired}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="rounded-full bg-yellow-100 p-3 mr-4">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Expirando em Breve</p>
              <p className="text-2xl font-bold">{stats.expiring_soon}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="rounded-full bg-green-100 p-3 mr-4">
              <Send className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total de Clientes</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Área Principal - Dividida em duas colunas em telas maiores */}
      <div className="flex flex-col lg:flex-row gap-6">
      
        {/* Formulário de Envio */}
        <div className="flex-1 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Nova Mensagem</h2>
          
          {/* Segmento */}
          <div className="mb-4">
            <label className="block mb-2 font-medium">Segmento de Clientes</label>
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              className="w-full p-2 border rounded"
              disabled={isSending}
            >
              <option value="active">Assinaturas Ativas ({stats.active})</option>
              <option value="expired">Assinaturas Expiradas ({stats.expired})</option>
              <option value="expiring_soon">Expirando em Breve ({stats.expiring_soon})</option>
              <option value="all">Todos os Clientes ({stats.total})</option>
            </select>
          </div>
          
          {/* Filtro adicional para clientes ativos */}
          {segment === 'active' && (
            <div className="mb-4">
              <label className="block mb-2 font-medium">Filtrar por dias até expiração</label>
              <select
                value={daysThreshold === null ? '' : daysThreshold}
                onChange={(e) => setDaysThreshold(e.target.value === '' ? null : parseInt(e.target.value))}
                className="w-full p-2 border rounded"
                disabled={isSending}
              >
                <option value="">Todos os clientes ativos</option>
                <option value="7">Expira em até 7 dias</option>
                <option value="15">Expira em até 15 dias</option>
                <option value="30">Expira em até 30 dias</option>
              </select>
            </div>
          )}
          
          {/* Mensagem */}
          <div className="mb-4">
            <label className="block mb-2 font-medium">Mensagem</label>
            <div className="text-xs text-gray-500 mb-1">
              <span className="flex items-center">
                <Info size={14} className="mr-1" />
                Variáveis disponíveis: {'{nome}'}, {'{plano}'}, {'{data_expiracao}'}, {'{dias_restantes}'}
              </span>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-2 border rounded"
              rows={6}
              placeholder="Digite sua mensagem aqui..."
              disabled={isSending}
            ></textarea>
          </div>
          
          {/* Upload de Imagem */}
          <div className="mb-4">
            <label className="block mb-2 font-medium">Imagem (opcional)</label>
            <div className="flex items-center">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                ref={fileInputRef}
                disabled={isSending}
              />
              <button
                onClick={() => fileInputRef.current.click()}
                className="flex items-center px-4 py-2 border rounded bg-gray-50 hover:bg-gray-100 mr-3"
                disabled={isSending}
              >
                <Image size={18} className="mr-2" />
                Selecionar Imagem
              </button>
              
              {selectedImage && (
                <button
                  onClick={removeImage}
                  className="flex items-center px-3 py-2 text-red-600 hover:text-red-800"
                  disabled={isSending}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            
            {/* Preview da Imagem */}
            {imagePreview && (
              <div className="mt-3">
                <p className="text-sm text-gray-500 mb-1">Preview:</p>
                <div className="w-32 h-32 border rounded overflow-hidden">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* Configuração de Delay */}
          <div className="mb-6">
            <label className="block mb-2 font-medium">Intervalo entre mensagens (segundos)</label>
            <div className="flex items-center">
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={delaySeconds} 
                onChange={(e) => setDelaySeconds(parseInt(e.target.value))}
                className="w-full mr-3"
                disabled={isSending}
              />
              <span className="w-10 text-center font-semibold">{delaySeconds}s</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Um intervalo maior reduz o risco de bloqueio pelo WhatsApp, mas torna o envio mais lento.
            </p>
          </div>
          
          {/* Botão de Envio */}
          <div className="flex justify-end">
            <button
              onClick={handleSendMessage}
              disabled={isSending}
              className={`flex items-center px-4 py-2 rounded ${
                isSending 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isSending ? (
                <>
                  <RefreshCw className="mr-2 animate-spin" /> Enviando...
                </>
              ) : (
                <>
                  <Send className="mr-2" /> Enviar Mensagens
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Área de Status e Histórico */}
        <div className="flex-1 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Status e Histórico</h2>
          
          {/* Status Atual */}
          {taskStatus && (
            <div className="mb-6">
              <h3 className="font-medium mb-2">Envio Atual</h3>
              <div className="bg-gray-50 p-4 rounded">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <span className={`text-sm font-medium px-2 py-1 rounded ${renderTaskStatusColor(taskStatus.status)}`}>
                      {renderTaskStatusText(taskStatus.status)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    Iniciado: {formatDate(taskStatus.started_at)}
                  </div>
                </div>
                
                {/* Barra de Progresso */}
                {taskStatus.total_recipients > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progresso: {taskStatus.processed} de {taskStatus.total_recipients}</span>
                      <span>{Math.floor((taskStatus.processed / taskStatus.total_recipients) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full"
                        style={{ width: `${(taskStatus.processed / taskStatus.total_recipients) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                
                {/* Estatísticas */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-gray-100 p-2 rounded text-center">
                    <div className="text-sm text-gray-500">Total</div>
                    <div className="font-semibold">{taskStatus.total_recipients}</div>
                  </div>
                  <div className="bg-green-50 p-2 rounded text-center">
                    <div className="text-sm text-green-600">Sucesso</div>
                    <div className="font-semibold text-green-700">{taskStatus.successful}</div>
                  </div>
                  <div className="bg-red-50 p-2 rounded text-center">
                    <div className="text-sm text-red-600">Falhas</div>
                    <div className="font-semibold text-red-700">{taskStatus.failed}</div>
                  </div>
                </div>
                
                {/* Logs */}
                <h4 className="font-medium mb-2 text-sm">Logs de Envio</h4>
                {renderLogs()}
              </div>
            </div>
          )}
          
          {/* Histórico de Envios */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium">Histórico de Envios</h3>
              <button
                onClick={fetchHistory}
                className="text-blue-600 hover:text-blue-800"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            
            {history.length > 0 ? (
              <div className="bg-gray-50 rounded divide-y">
                {history.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="p-3 hover:bg-gray-100">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className={`text-xs font-medium px-2 py-1 rounded ${renderTaskStatusColor(item.status)}`}>
                          {renderTaskStatusText(item.status)}
                        </span>
                        <span className="ml-2 text-sm">{item.segment}</span>
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(item.started_at)}</div>
                    </div>
                    <div className="mt-1 text-sm">
                      <span className="text-green-600">{item.successful || 0} enviadas</span>
                      <span className="mx-1">•</span>
                      <span className="text-red-600">{item.failed || 0} falhas</span>
                      <span className="mx-1">•</span>
                      <span>{item.total_recipients || 0} total</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">Nenhum envio anterior registrado</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Ajuda */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-medium mb-2 text-blue-800">Como usar o envio de mensagens em massa</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
          <li>Escolha um <strong>segmento</strong> de clientes para enviar a mensagem</li>
          <li>Personalize sua mensagem usando variáveis como <code>{'{nome}'}</code> e <code>{'{data_expiracao}'}</code></li>
          <li>Adicione uma <strong>imagem</strong> opcional para acompanhar sua mensagem</li>
          <li>Configure o <strong>intervalo</strong> entre mensagens para evitar bloqueios do WhatsApp</li>
          <li>Acompanhe o <strong>progresso</strong> do envio e o status de cada mensagem em tempo real</li>
        </ul>
      </div>
    </div>
  );
};

export default MassMessaging;
