const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const venom = require('venom-bot');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');

// Configuração de logs aprimorada
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = fs.createWriteStream(path.join(logDir, `whatsapp-service-${new Date().toISOString().split('T')[0]}.log`), { flags: 'a' });

function logWithTimestamp(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  
  console.log(logMessage);
  logFile.write(logMessage + '\n');
}

// Inicializar o app Express e servidor HTTP
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 8080;

// Configurar middleware para JSON
app.use(express.json());

// Configurar CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Criar diretório uploads se não existir
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Usar timestamp no nome do arquivo para evitar conflitos
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });
// Criar servidor WebSocket
const wss = new WebSocket.Server({ server });

// Estado global
let client = null;
let qrCodeDataURL = null;
let connectionStatus = 'disconnected';
let clients = new Set();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 30000; // 30 segundos
let reconnectTimeout = null;

// Caminho para o QR code
const QR_CODE_PATH = path.join(__dirname, 'qrcode.png');
const SESSION_NAME = 'whatsapp-session';

// URL do webhook para enviar mensagens recebidas
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://backend:8000/api/whatsapp/webhook';

// Função para configurar reconexão automática
function setupReconnection() {
  if (client) {
    logWithTimestamp('Configurando sistema de reconexão automática', 'INFO');
    
    client.onStateChange((state) => {
      logWithTimestamp(`Estado do WhatsApp mudou para: ${state}`, 'DEBUG');
      
      // Quando o estado indicar desconexão
      if (
        (state === 'CONFLICT' || 
         state === 'UNPAIRED' || 
         state === 'UNLAUNCHED' || 
         state === 'DISCONNECTED') && 
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS
      ) {
        reconnectAttempts++;
        logWithTimestamp(`Tentativa de reconexão ${reconnectAttempts} de ${MAX_RECONNECT_ATTEMPTS}`, 'WARN');
        
        // Limpar timeout anterior se existir
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
        
        reconnectTimeout = setTimeout(() => {
          logWithTimestamp('Tentando reiniciar o serviço WhatsApp...', 'INFO');
          
          client.restartService().then(() => {
            logWithTimestamp('Serviço do WhatsApp reiniciado com sucesso', 'INFO');
            connectionStatus = 'connected';
            reconnectAttempts = 0;
            
            // Atualizar status para todos os clientes
            broadcastToClients({
              type: 'connection',
              status: 'connected'
            });
          }).catch(err => {
            logWithTimestamp(`Erro ao reiniciar serviço: ${err}`, 'ERROR');
            
            // Se atingiu limite de tentativas, reinicializar completamente
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              logWithTimestamp('Atingido limite de tentativas. Reinicializando cliente...', 'WARN');
              initializeWhatsAppClient();
            }
          });
        }, RECONNECT_INTERVAL);
      }
    });
  }
}
// Inicializar cliente WhatsApp usando Venom
function initializeWhatsAppClient() {
  logWithTimestamp('Inicializando cliente WhatsApp usando Venom...', 'INFO');
  
  // Registrar informações do ambiente para debug
  logWithTimestamp(`Node version: ${process.version}`, 'DEBUG');
  logWithTimestamp(`OS: ${process.platform}`, 'DEBUG');
  logWithTimestamp(`Working directory: ${process.cwd()}`, 'DEBUG');
  logWithTimestamp(`Webhook URL: ${WEBHOOK_URL}`, 'DEBUG');
  
  try {
    // Definir opções do Venom
    const venomOptions = {
      session: SESSION_NAME,
      multidevice: true,
      headless: 'new', // Atualizado para 'new' conforme recomendação
      useChrome: false,
      debug: true,
      logQR: true,
      disableWelcome: true,
      // Novas configurações para melhorar desempenho
      disableMediaAutoDownload: true, // Evitar download automático de mídia
      disableReadReceipts: true,      // Desabilitar recebimentos de leitura
      disablePreviewVideo: true,      // Desabilitar preview de vídeo
      useStealth: true,               // Usar modo stealth para evitar detecção
      disableWelcome: true,           // Desabilitar mensagem de boas-vindas
      folderNameToken: 'tokens',
      smartQRScan: false,
      maxMessagesPerCycle: 20,        // Limitar número de mensagens processadas por ciclo
      browserArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--mute-audio',
        '--hide-scrollbars',
        '--no-first-run',
        '--disable-features=site-per-process',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-web-security',
        '--js-flags="--max-old-space-size=4096"'  // Aumentar memória disponível
      ]
    };

    // Iniciar o Venom
    venom
      .create(
        SESSION_NAME,
        (base64Qr, asciiQR, attempts, urlCode) => {
          logWithTimestamp(`QR Code recebido, tentativa: ${attempts}`, 'INFO');
          
          // Converter o QR code para formato de imagem e salvar
          saveQRCode(base64Qr);
          
          // Salvar a versão texto do QR code
          fs.writeFileSync('last_qrcode.txt', asciiQR);
          
          // Enviar QR code para todos os clientes WebSocket
          broadcastToClients({
            type: 'qr',
            qrCode: base64Qr
          });
        },
        (statusSession, session) => {
          logWithTimestamp(`Status da sessão: ${statusSession}`, 'INFO');
          connectionStatus = statusSession;
          
          // Atualizar status para todos os clientes
          broadcastToClients({
            type: 'connection',
            status: statusSession
          });
        },
        venomOptions
      )
      .then((venomClient) => {
        logWithTimestamp('Cliente Venom criado com sucesso!', 'INFO');
        client = venomClient;
        connectionStatus = 'connected';
        reconnectAttempts = 0;
        
        // Configurar reconexão automática
        setupReconnection();
        
        // Configurar evento de mensagem recebida
        client.onMessage((message) => {
          // Verificar se a mensagem é recente (menos de 5 minutos)
          const now = new Date();
          const messageTime = new Date(message.timestamp * 1000);
          const messageAgeMinutes = (now - messageTime) / (1000 * 60);
          
          // Verificar se a mensagem não é muito antiga
          if (messageAgeMinutes > 5) {
            logWithTimestamp(`Ignorando mensagem antiga de ${message.from}: ${message.body}`, 'DEBUG');
            return;
          }
          
          logWithTimestamp(`Mensagem recebida de ${message.from}: ${message.body}`, 'INFO');
          
          // Enviar a mensagem para o webhook do backend
          try {
            logWithTimestamp(`Enviando mensagem para webhook ${WEBHOOK_URL}`, 'DEBUG');
            axios.post(WEBHOOK_URL, {
              type: 'message',
              message: {
                from: message.from,
                body: message.body,
                timestamp: message.timestamp,
                id: message.id
              }
            })
            .then(response => {
              logWithTimestamp('Mensagem enviada para webhook com sucesso', 'DEBUG');
            })
            .catch(error => {
              logWithTimestamp(`Erro ao enviar mensagem para webhook: ${error.message}`, 'ERROR');
              if (error.response) {
                logWithTimestamp(`Resposta do erro: ${JSON.stringify(error.response.data)}`, 'ERROR');
              }
            });
          } catch (err) {
            logWithTimestamp(`Erro ao tentar enviar para webhook: ${err}`, 'ERROR');
          }
          
          // Enviar a mensagem para todos os clientes conectados
          broadcastToClients({
            type: 'message',
            message: {
              from: message.from,
              body: message.body,
              timestamp: message.timestamp
            }
          });
          
          // Exemplo de resposta automática
          if (message.body.toLowerCase() === 'olá' || message.body.toLowerCase() === 'ola') {
            client.sendText(message.from, 'Olá! Como posso ajudar?')
              .then(() => logWithTimestamp('Resposta automática enviada', 'INFO'))
              .catch(err => logWithTimestamp(`Erro ao enviar resposta automática: ${err}`, 'ERROR'));
          }
        });
        
        return client;
      })
      .catch((error) => {
        logWithTimestamp(`Erro ao criar cliente Venom: ${error}`, 'ERROR');
        connectionStatus = 'error';
        
        // Gerar QR Code de teste em caso de falha
        generateTestQRCode('Falha ao inicializar WhatsApp. Tente novamente.');
        
        return null;
      });
      
    return true;
  
  } catch (error) {
    logWithTimestamp(`Exceção ao inicializar Venom: ${error}`, 'ERROR');
    generateTestQRCode('Erro ao inicializar. Tente novamente.');
    return false;
  }
}
// Função para salvar o QR code
function saveQRCode(base64Qr) {
  try {
    // Se o QR code está em formato base64 com cabeçalho
    if (base64Qr.startsWith('data:')) {
      // Remover o cabeçalho de data URL se existir
      const base64Data = base64Qr.split(',')[1];
      fs.writeFileSync(QR_CODE_PATH, Buffer.from(base64Data, 'base64'));
    } else {
      // Se for apenas string base64
      fs.writeFileSync(QR_CODE_PATH, Buffer.from(base64Qr, 'base64'));
    }
    
    qrCodeDataURL = base64Qr;
    logWithTimestamp(`QR code salvo com sucesso: ${QR_CODE_PATH}`, 'INFO');
    return true;
  } catch (error) {
    logWithTimestamp(`Erro ao salvar QR code: ${error}`, 'ERROR');
    return false;
  }
}

// Função para gerar um QR code de teste
async function generateTestQRCode(message) {
  try {
    const testQrData = message || 'https://example.com/test';
    
    // Gerar QR code como imagem
    await qrcode.toFile('test_qrcode.png', testQrData);
    
    // Gerar QR code como data URL
    qrCodeDataURL = await qrcode.toDataURL(testQrData);
    
    logWithTimestamp('QR code de teste gerado', 'INFO');
    return qrCodeDataURL;
  } catch (error) {
    logWithTimestamp(`Erro ao gerar QR code de teste: ${error}`, 'ERROR');
    return null;
  }
}

// Função para enviar mensagem para um número
async function sendMessage(to, text) {
  if (!client) {
    throw new Error('WhatsApp não está conectado');
  }
  
  try {
    // Formatação do número (se necessário)
    let formattedNumber = to;
    if (!formattedNumber.includes('@')) {
      // Remove tudo exceto dígitos
      formattedNumber = formattedNumber.replace(/\D/g, '');
      
      // Adiciona @c.us para chat individual (formato do Venom)
      formattedNumber = `${formattedNumber}@c.us`;
    }
    
    logWithTimestamp(`Enviando mensagem para ${formattedNumber}: ${text}`, 'INFO');
    
    // Enviar mensagem usando Venom
    const result = await client.sendText(formattedNumber, text);
    
    return { 
      success: true, 
      messageId: result.id || 'sent'
    };
  } catch (error) {
    logWithTimestamp(`Erro ao enviar mensagem: ${error}`, 'ERROR');
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Função para obter informações do contato
async function getContactInfo(phoneNumber) {
  if (!client) {
    throw new Error('WhatsApp não está conectado');
  }
  
  try {
    // Formatação do número (se necessário)
    let formattedNumber = phoneNumber;
    if (!formattedNumber.includes('@')) {
      // Remove tudo exceto dígitos
      formattedNumber = formattedNumber.replace(/\D/g, '');
      
      // Adiciona @c.us para chat individual (formato do Venom)
      formattedNumber = `${formattedNumber}@c.us`;
    }
    
    logWithTimestamp(`Obtendo informações do contato ${formattedNumber}`, 'DEBUG');
    
    // Obter informações do contato usando Venom
    const contactInfo = await client.getContact(formattedNumber);
    
    // Determinar se o contato está salvo
    const isSaved = !!(contactInfo.name || contactInfo.pushname);
    
    return {
      success: true,
      is_saved: isSaved,
      contact_name: contactInfo.name || contactInfo.pushname || '',
      number: phoneNumber,
      formatted_number: formattedNumber
    };
  } catch (error) {
    logWithTimestamp(`Erro ao obter informações do contato: ${error}`, 'ERROR');
    return {
      success: false,
      error: error.message,
      number: phoneNumber
    };
  }
}

// Função para enviar dados para todos os clientes WebSocket
function broadcastToClients(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}
// Configurar WebSocket
wss.on('connection', (ws) => {
  logWithTimestamp('Cliente WebSocket conectado', 'INFO');
  clients.add(ws);
  
  // Enviar o status atual e QR code (se disponível) para o novo cliente
  ws.send(JSON.stringify({
    type: 'connection',
    status: connectionStatus
  }));
  
  if (qrCodeDataURL && connectionStatus !== 'connected') {
    ws.send(JSON.stringify({
      type: 'qr',
      qrCode: qrCodeDataURL
    }));
  }
  
  // Evento quando o cliente desconecta
  ws.on('close', () => {
    logWithTimestamp('Cliente WebSocket desconectado', 'INFO');
    clients.delete(ws);
  });
  
  // Receber mensagens do cliente
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'send-message') {
        const result = await sendMessage(data.to, data.text);
        ws.send(JSON.stringify({
          type: 'send-message-result',
          id: data.id,
          success: result.success,
          error: result.error
        }));
      }
    } catch (error) {
      logWithTimestamp(`Erro ao processar mensagem do cliente: ${error}`, 'ERROR');
    }
  });
});

// Rota para iniciar a conexão
app.get('/start', async (req, res) => {
  try {
    if (!client) {
      logWithTimestamp('Iniciando conexão com WhatsApp via /start', 'INFO');
      const initialized = initializeWhatsAppClient();
      res.json({ 
        success: true, 
        message: 'Iniciando conexão com WhatsApp',
        initialized
      });
    } else {
      res.json({ 
        success: true, 
        message: 'WhatsApp já está conectado ou conectando', 
        status: connectionStatus 
      });
    }
  } catch (error) {
    logWithTimestamp(`Erro ao iniciar WhatsApp: ${error}`, 'ERROR');
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Rota para obter o status atual
app.get('/status', (req, res) => {
  res.json({ 
    status: connectionStatus,
    connected: connectionStatus === 'connected' || connectionStatus === 'isLogged'
  });
});

// Rota para obter o QR code atual
app.get('/qr', (req, res) => {
  if (qrCodeDataURL && (connectionStatus !== 'connected' && connectionStatus !== 'isLogged')) {
    res.json({ qr_code: qrCodeDataURL });
  } else if (connectionStatus === 'connected' || connectionStatus === 'isLogged') {
    res.status(400).json({ error: 'Já conectado ao WhatsApp' });
  } else {
    // Se não houver QR code disponível, tentar gerar um
    if (fs.existsSync(QR_CODE_PATH)) {
      const imageBuffer = fs.readFileSync(QR_CODE_PATH);
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      res.json({ qr_code: base64Image });
    } else if (fs.existsSync('test_qrcode.png')) {
      const imageBuffer = fs.readFileSync('test_qrcode.png');
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      res.json({ qr_code: base64Image });
    } else {
      res.status(404).json({ error: 'QR Code não disponível' });
    }
  }
});
// Rota para enviar mensagem
app.post('/send', async (req, res) => {
  const { jid, text } = req.body;
  
  if (!jid || !text) {
    return res.status(400).json({ 
      success: false, 
      error: 'Número e texto são obrigatórios' 
    });
  }
  
  try {
    const result = await sendMessage(jid, text);
    res.json(result);
  } catch (error) {
    logWithTimestamp(`Erro na rota /send: ${error}`, 'ERROR');
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Rota para enviar imagem
app.post('/send-image', upload.single('file'), async (req, res) => {
  if (!client) {
    return res.status(400).json({ success: false, error: 'WhatsApp não está conectado' });
  }
  
  try {
    const { jid } = req.body;
    const caption = req.body.caption || '';
    
    if (!jid) {
      return res.status(400).json({ success: false, error: 'Número de telefone (jid) é obrigatório' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    }
    
    // Formatação do número (se necessário)
    let formattedNumber = jid;
    if (!formattedNumber.includes('@')) {
      // Remove tudo exceto dígitos
      formattedNumber = formattedNumber.replace(/\D/g, '');
      
      // Adiciona @c.us para chat individual (formato do Venom)
      formattedNumber = `${formattedNumber}@c.us`;
    }
    
    logWithTimestamp(`Enviando imagem para ${formattedNumber}`, 'INFO');
    
    // Enviar imagem usando Venom
    const result = await client.sendImage(
      formattedNumber,
      req.file.path,
      req.file.originalname,
      caption
    );
    
    return res.json({ 
      success: true, 
      messageId: result.id || 'sent' 
    });
  } catch (error) {
    logWithTimestamp(`Erro ao enviar imagem: ${error}`, 'ERROR');
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Rota para verificar informações de contato
app.get('/contact-info/:phone', async (req, res) => {
  const phone = req.params.phone;
  
  if (!phone) {
    return res.status(400).json({
      success: false,
      error: 'Número de telefone não fornecido'
    });
  }
  
  try {
    const contactInfo = await getContactInfo(phone);
    res.json(contactInfo);
  } catch (error) {
    logWithTimestamp(`Erro ao obter informações de contato: ${error}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rota para verificar se um contato tem palavra-chave no nome
app.get('/check-keyword/:phone', async (req, res) => {
  const phone = req.params.phone;
  const keyword = req.query.keyword;
  
  if (!phone) {
    return res.status(400).json({
      success: false,
      error: 'Número de telefone não fornecido'
    });
  }
  
  try {
    const contactInfo = await getContactInfo(phone);
    
    if (!contactInfo.success) {
      return res.json(contactInfo);
    }
    
    // Verificar se o contato tem a palavra-chave no nome
    const contactName = contactInfo.contact_name || '';
    const hasKeyword = keyword ? 
      contactName.toLowerCase().includes(keyword.toLowerCase()) : 
      false;
    
    return res.json({
      ...contactInfo,
      has_keyword: hasKeyword,
      keyword: keyword
    });
  } catch (error) {
    logWithTimestamp(`Erro ao verificar keyword: ${error}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Rota para logout
app.post('/logout', async (req, res) => {
  try {
    if (client) {
      await client.logout();
      await client.close();
      client = null;
      connectionStatus = 'disconnected';
      qrCodeDataURL = null;
      
      // Limpar arquivos de sessão
      const sessionDir = path.join(__dirname, 'tokens', SESSION_NAME);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      
      res.json({ 
        success: true, 
        message: 'Desconectado com sucesso' 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Não estava conectado' 
      });
    }
  } catch (error) {
    logWithTimestamp(`Erro ao desconectar: ${error}`, 'ERROR');
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Rota estática para ver o QR code como imagem
app.get('/qr-image', (req, res) => {
  if (fs.existsSync(QR_CODE_PATH)) {
    res.sendFile(QR_CODE_PATH);
  } else if (fs.existsSync('test_qrcode.png')) {
    res.sendFile(path.join(__dirname, 'test_qrcode.png'));
  } else {
    generateTestQRCode('QR Code temporário')
      .then(() => {
        res.sendFile(path.join(__dirname, 'test_qrcode.png'));
      })
      .catch(error => {
        res.status(500).send(`Erro ao gerar QR Code: ${error.message}`);
      });
  }
});

// Rota para verificar ambiente
app.get('/debug', (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    
    const debugInfo = {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      env: process.env.NODE_ENV,
      clientInitialized: client !== null,
      connectionStatus,
      hasQrCode: qrCodeDataURL !== null,
      qrImageExists: fs.existsSync(QR_CODE_PATH),
      testQrExists: fs.existsSync('test_qrcode.png'),
      directories: fs.readdirSync('./'),
      tokenDirExists: fs.existsSync('./tokens'),
      tokenSessionExists: fs.existsSync(`./tokens/${SESSION_NAME}`),
      webhookUrl: WEBHOOK_URL,
      memoryUsage: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
      },
      reconnectAttempts,
      activeSessions: client ? 'Sim' : 'Não',
      logFiles: fs.existsSync(logDir) ? fs.readdirSync(logDir) : []
    };
    
    res.json(debugInfo);
  } catch (error) {
    logWithTimestamp(`Erro na rota /debug: ${error}`, 'ERROR');
    res.status(500).json({ error: error.toString() });
  }
});

// Endpoint para forçar a geração de um QR code de teste
app.get('/generate-test-qr', async (req, res) => {
  try {
    const qrData = await generateTestQRCode('WhatsApp test connection');
    
    res.json({ 
      success: true, 
      message: 'QR Code de teste gerado',
      qr_code: qrData
    });
  } catch (error) {
    logWithTimestamp(`Erro ao gerar QR de teste: ${error}`, 'ERROR');
    res.status(500).json({ error: error.toString() });
  }
});

// Rota para visualizar logs
app.get('/logs', (req, res) => {
  try {
    const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    
    // Se um arquivo específico for solicitado
    if (req.query.file && logFiles.includes(req.query.file)) {
      const logContent = fs.readFileSync(path.join(logDir, req.query.file), 'utf8');
      // Retornar apenas as últimas 1000 linhas para não sobrecarregar
      const lines = logContent.split('\n').slice(-1000).join('\n');
      return res.send(lines);
    }
    
    // Caso contrário, retornar lista de arquivos
    res.json({ files: logFiles });
  } catch (error) {
    logWithTimestamp(`Erro na rota /logs: ${error}`, 'ERROR');
    res.status(500).json({ error: error.toString() });
  }
});
// Rota para limpar o cache e arquivos temporários
app.post('/clear-cache', async (req, res) => {
  try {
    logWithTimestamp('Solicitação para limpar cache recebida', 'INFO');
    
    // Verifica se o cliente está conectado
    if (client) {
      logWithTimestamp('Fechando cliente atual antes de limpar cache', 'INFO');
      await client.close();
      client = null;
    }
    
    // Lista de diretórios para limpar
    const dirsToClean = [
      {path: path.join(__dirname, '.wwebjs_auth'), desc: 'Cache de autenticação'},
      {path: path.join(__dirname, '.wwebjs_cache'), desc: 'Cache do navegador'},
      {path: path.join(__dirname, 'tokens'), desc: 'Tokens de sessão'}
    ];
    
    const results = [];
    
    // Limpar cada diretório
    for (const dir of dirsToClean) {
      if (fs.existsSync(dir.path)) {
        try {
          fs.rmSync(dir.path, { recursive: true, force: true });
          results.push(`${dir.desc} limpo com sucesso`);
          logWithTimestamp(`Diretório ${dir.path} removido com sucesso`, 'INFO');
        } catch (err) {
          const errorMsg = `Erro ao limpar ${dir.desc}: ${err.message}`;
          results.push(errorMsg);
          logWithTimestamp(errorMsg, 'ERROR');
        }
      } else {
        results.push(`${dir.desc} não encontrado`);
      }
    }
    
    // Remover arquivos de QR code
    if (fs.existsSync(QR_CODE_PATH)) {
      fs.unlinkSync(QR_CODE_PATH);
      results.push('Arquivo QR code removido');
    }
    
    if (fs.existsSync('test_qrcode.png')) {
      fs.unlinkSync('test_qrcode.png');
      results.push('Arquivo QR code de teste removido');
    }
    
    connectionStatus = 'disconnected';
    qrCodeDataURL = null;
    reconnectAttempts = 0;
    
    res.json({
      success: true,
      message: 'Cache limpo com sucesso',
      details: results
    });
    
  } catch (error) {
    logWithTimestamp(`Erro ao limpar cache: ${error}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rota para monitoramento de saúde do sistema
app.get('/health', (req, res) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Verificar se o WhatsApp está funcionando
    const whatsappOk = client !== null && 
                      (connectionStatus === 'connected' || 
                       connectionStatus === 'isLogged');
    
    // Calcular o uso de memória
    const memoryUsedPercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);
    const memoryStatus = memoryUsedPercent > 90 ? 'critical' : 
                         memoryUsedPercent > 70 ? 'warning' : 'ok';
    
    res.json({
      status: whatsappOk ? 'ok' : 'degraded',
      uptime: {
        seconds: Math.floor(uptime),
        formatted: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        usage: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        percent: `${memoryUsedPercent}%`,
        status: memoryStatus
      },
      whatsapp: {
        connected: whatsappOk,
        status: connectionStatus,
        reconnectAttempts
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logWithTimestamp(`Erro na rota /health: ${error}`, 'ERROR');
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Rota para reiniciar o cliente do WhatsApp
app.post('/restart', async (req, res) => {
  try {
    logWithTimestamp('Solicitação para reiniciar cliente WhatsApp recebida', 'INFO');
    
    // Verificar se há um cliente ativo
    if (client) {
      logWithTimestamp('Fechando cliente atual antes de reiniciar', 'INFO');
      try {
        await client.close();
      } catch (closeError) {
        logWithTimestamp(`Erro ao fechar cliente: ${closeError}`, 'WARN');
        // Continuar mesmo se houver erro ao fechar
      }
      client = null;
    }
    
    connectionStatus = 'disconnected';
    qrCodeDataURL = null;
    reconnectAttempts = 0;
    
    // Iniciar novo cliente
    logWithTimestamp('Iniciando novo cliente WhatsApp', 'INFO');
    const initialized = initializeWhatsAppClient();
    
    res.json({
      success: true,
      message: 'Cliente WhatsApp reiniciado',
      initialized
    });
    
  } catch (error) {
    logWithTimestamp(`Erro ao reiniciar cliente: ${error}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Iniciar servidor
server.listen(port, '0.0.0.0', () => {
  logWithTimestamp(`Servidor WhatsApp rodando na porta ${port}`, 'INFO');
  
  // Criar diretórios necessários
  if (!fs.existsSync('./tokens')) {
    fs.mkdirSync('./tokens', { recursive: true });
    logWithTimestamp('Diretório ./tokens criado', 'INFO');
  }
  
  // Criar diretório para uploads de imagens
  if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads', { recursive: true });
    logWithTimestamp('Diretório ./uploads criado', 'INFO');
  }
  
  // Configurar coleta de lixo periódica para evitar vazamentos de memória
  const GARBAGE_COLLECTION_INTERVAL = 1800000; // 30 minutos
  setInterval(() => {
    logWithTimestamp('Executando coleta de lixo manualmente', 'INFO');
    try {
      if (global.gc) {
        global.gc();
        logWithTimestamp('Coleta de lixo executada com sucesso', 'INFO');
      }
    } catch (e) {
      logWithTimestamp('Coleta de lixo não disponível. Execute o Node com --expose-gc', 'WARN');
    }
    
    // Registrar uso de memória
    const memoryUsage = process.memoryUsage();
    logWithTimestamp(`Uso de memória - RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`, 'INFO');
  }, GARBAGE_COLLECTION_INTERVAL);
  
  // Configurar limpeza periódica de arquivos temporários
  const TEMP_FILES_CLEANUP_INTERVAL = 86400000; // 24 horas
  setInterval(() => {
    logWithTimestamp('Iniciando limpeza de arquivos temporários', 'INFO');
    
    // Limpar diretório de uploads
    const uploadDir = './uploads';
    if (fs.existsSync(uploadDir)) {
      try {
        const files = fs.readdirSync(uploadDir);
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const file of files) {
          const filePath = path.join(uploadDir, file);
          const stats = fs.statSync(filePath);
          
          // Remover arquivos com mais de 24 horas
          const fileAge = now - stats.mtimeMs;
          if (fileAge > 86400000) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        }
        
        logWithTimestamp(`Limpeza concluída: ${cleanedCount} arquivos removidos`, 'INFO');
      } catch (error) {
        logWithTimestamp(`Erro ao limpar arquivos temporários: ${error}`, 'ERROR');
      }
    }
  }, TEMP_FILES_CLEANUP_INTERVAL);
  
  // Iniciar a conexão automaticamente quando o servidor inicia
  initializeWhatsAppClient();
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  logWithTimestamp(`Erro não capturado: ${error.stack || error}`, 'ERROR');
  // Não finalizar o processo, apenas registrar o erro
});

process.on('unhandledRejection', (reason, promise) => {
  logWithTimestamp(`Promessa rejeitada não tratada: ${reason}`, 'ERROR');
  // Não finalizar o processo, apenas registrar o erro
});

// Tratamento para encerramento gracioso
process.on('SIGTERM', async () => {
  logWithTimestamp('Sinal SIGTERM recebido. Encerrando aplicação...', 'INFO');
  await cleanupAndExit();
});

process.on('SIGINT', async () => {
  logWithTimestamp('Sinal SIGINT recebido. Encerrando aplicação...', 'INFO');
  await cleanupAndExit();
});

// Função para limpeza e encerramento gracioso
async function cleanupAndExit() {
  logWithTimestamp('Iniciando processo de encerramento gracioso', 'INFO');
  
  // Fechar cliente WhatsApp se estiver aberto
  if (client) {
    logWithTimestamp('Fechando cliente WhatsApp', 'INFO');
    try {
      await client.close();
      logWithTimestamp('Cliente WhatsApp fechado com sucesso', 'INFO');
    } catch (error) {
      logWithTimestamp(`Erro ao fechar cliente WhatsApp: ${error}`, 'ERROR');
    }
  }
  
  // Fechar conexões WebSocket
  logWithTimestamp('Fechando conexões WebSocket', 'INFO');
  wss.clients.forEach((ws) => {
    ws.close();
  });
  
  // Fechar o servidor HTTP
  logWithTimestamp('Fechando servidor HTTP', 'INFO');
  server.close(() => {
    logWithTimestamp('Servidor HTTP fechado', 'INFO');
    
    // Encerrar o processo após a limpeza
    logWithTimestamp('Aplicação encerrada', 'INFO');
    process.exit(0);
  });
  
  // Se o servidor não fechar em 5 segundos, forçar o encerramento
  setTimeout(() => {
    logWithTimestamp('Tempo limite para encerramento gracioso excedido. Forçando saída.', 'WARN');
    process.exit(1);
  }, 5000);
}

