const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const app = express();
const port = process.env.PORT || 8080;

// Configurar o upload de arquivos
const upload = multer({ dest: 'uploads/' });

// Variáveis globais
let client = null;
let qrString = null;
let qrImagePath = path.join(__dirname, 'qrcode.png');
let connectionStatus = 'disconnected';
let connectionInfo = null;
let lastActivity = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let reconnectTimeout = null;
let connectedPhoneNumber = null;
let sessionActive = false;

// Middleware para parsear JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Função para inicializar o cliente WhatsApp
function initializeClient() {
    console.log('[INFO] Inicializando cliente WhatsApp...');
    
    // Limpar qualquer timeout de reconexão pendente
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    // Opções do puppeteer
    const puppeteerOptions = {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1280,720',
        ],
        headless: true,
        timeout: 120000, // Timeout aumentado para 2 minutos
    };
    
    // Se temos um endpoint WebSocket definido, usamos-lo
    const wsEndpoint = process.env.PUPPETEER_WS_ENDPOINT;
    if (wsEndpoint) {
        console.log(`[INFO] Usando endpoint WebSocket: ${wsEndpoint}`);
        puppeteerOptions.browserWSEndpoint = wsEndpoint;
    }
    
    // Tentar recuperar sessão anterior, se disponível
    try {
        // Verificar se existem arquivos de sessão
        const sessionPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(sessionPath)) {
            console.log('[INFO] Arquivos de sessão encontrados, tentando recuperar sessão...');
        }
    } catch (e) {
        console.error('[ERROR] Erro ao verificar arquivos de sessão:', e);
    }
    
    // Criar o cliente com as opções especificadas
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: puppeteerOptions,
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://web.whatsapp.com/check-update?version=0.0.0',
        },
        restartOnAuthFail: true, // Tentar reiniciar automaticamente em caso de falha na autenticação
        takeoverOnConflict: true, // Tentar assumir o controle em caso de sessão em conflito
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    // Evento de QR Code
    client.on('qr', (qr) => {
        console.log('[INFO] QR Code recebido');
        qrString = qr;
        sessionActive = false;
        
        // Salvar QR Code como imagem
        qrcode.toFile(qrImagePath, qr, {
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (err) => {
            if (err) {
                console.error('[ERROR] Erro ao salvar QR Code:', err);
            } else {
                console.log('[INFO] QR code salvo como imagem');
            }
        });
    });
    
    // Evento de autenticação
    client.on('authenticated', () => {
        console.log('[INFO] Autenticado com sucesso');
        connectionStatus = 'authenticated';
        lastActivity = Date.now();
        sessionActive = true;
        reconnectAttempts = 0; // Resetar tentativas após autenticação
    });
    
    // Evento de falha de autenticação
    client.on('auth_failure', (msg) => {
        console.error('[ERROR] Falha na autenticação:', msg);
        connectionStatus = 'auth_failure';
        sessionActive = false;
        
        // Limpar os arquivos de sessão inválidos
        try {
            const sessionPath = path.join(__dirname, '.wwebjs_auth');
            if (fs.existsSync(sessionPath)) {
                console.log('[INFO] Tentando limpar arquivos de sessão inválidos...');
                // Não remover a pasta inteira, apenas os arquivos problemáticos
                const sessionFiles = fs.readdirSync(path.join(sessionPath, 'session'));
                for (const file of sessionFiles) {
                    if (file.includes('SingletonLock')) {
                        fs.unlinkSync(path.join(sessionPath, 'session', file));
                        console.log(`[INFO] Removido arquivo de sessão: ${file}`);
                    }
                }
            }
        } catch (e) {
            console.error('[ERROR] Erro ao limpar arquivos de sessão:', e);
        }
        
        // Se falhou na autenticação, tentar reconectar após um tempo
        scheduleReconnect(60000); // 1 minuto
    });
    
    // Evento quando o cliente está pronto
    client.on('ready', async () => {
        console.log('[INFO] Cliente pronto');
        connectionStatus = 'ready';
        lastActivity = Date.now();
        sessionActive = true;
        
        // Tentar obter informações da sessão
        try {
            // Obter informações do cliente conectado
            const info = await client.getState();
            connectionInfo = {
                connected: true,
                state: info
            };
            console.log('[INFO] Estado:', info);
            
            // Obter número de telefone conectado
            try {
                const clientInfo = await client.getWid();
                if (clientInfo) {
                    connectedPhoneNumber = clientInfo.user;
                    console.log('[INFO] Número conectado:', connectedPhoneNumber);
                }
            } catch (phoneError) {
                console.error('[ERROR] Erro ao obter número de telefone:', phoneError);
            }
            
            // Obter informação da versão do WhatsApp Web
            const wcVersion = client.info?.wwebVersion || "Desconhecida";
            console.log('[INFO] Versão do WhatsApp Web:', wcVersion);
        } catch (error) {
            console.error('[ERROR] Erro ao obter informações da sessão:', error);
            connectionInfo = {
                connected: true,
                error: error.message
            };
        }
    });
    
    // Evento de mensagem recebida
    client.on('message', async (msg) => {
        console.log('[INFO] Mensagem recebida:', msg.body);
        lastActivity = Date.now();
        
        // Notificar webhook sobre a mensagem (se configurado)
        const webhookUrl = process.env.WEBHOOK_URL;
        if (webhookUrl) {
            try {
                console.log('[DEBUG] Mensagem enviada para webhook', webhookUrl);
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'message',
                        message: {
                            from: msg.from,
                            to: msg.to,
                            body: msg.body,
                            timestamp: msg.timestamp,
                            hasMedia: msg.hasMedia,
                            type: msg.type,
                        }
                    }),
                });
                
                if (!response.ok) {
                    console.error('[ERROR] Erro ao enviar mensagem para webhook:', response.statusText);
                }
            } catch (error) {
                console.error('[ERROR] Erro ao enviar para webhook:', error);
            }
        }
    });
    
    // Evento de alteração de estado
    client.on('change_state', state => {
        console.log('[INFO] Estado do cliente alterado para:', state);
        if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
            console.warn('[WARNING] Detectado conflito ou estado não lançado, tentando reconectar...');
            scheduleReconnect(30000); // Tentar reconectar em 30 segundos
        }
    });
    
    // Evento de desconexão
    client.on('disconnected', (reason) => {
        console.log('[INFO] Cliente desconectado:', reason);
        connectionStatus = 'disconnected';
        connectionInfo = null;
        sessionActive = false;
        
        // Limpar dados do QR Code
        qrString = null;
        
        // Tentar reconectar automaticamente
        scheduleReconnect(30000); // 30 segundos
    });
    
    // Iniciar o cliente
    client.initialize().catch(error => {
        console.error('[ERROR] Erro ao inicializar cliente:', error);
        connectionStatus = 'error';
        
        // Tentar reconectar após erro de inicialização
        scheduleReconnect(60000); // 1 minuto
    });
}

// Função para agendar uma reconexão com backoff exponencial
function scheduleReconnect(initialDelay = 5000) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[INFO] Número máximo de tentativas de reconexão atingido. Resetando contador e tentando novamente.');
        reconnectAttempts = 0;
    }
    
    reconnectAttempts++;
    
    // Cálculo de backoff exponencial com máximo de 5 minutos
    const delay = Math.min(initialDelay * Math.pow(1.5, reconnectAttempts - 1), 300000);
    console.log(`[INFO] Agendando reconexão em ${delay}ms (tentativa ${reconnectAttempts})`);
    
    reconnectTimeout = setTimeout(() => {
        console.log('[INFO] Tentando reconectar...');
        
        // Limpar referência antiga do cliente
        if (client) {
            try {
                client.destroy();
            } catch (error) {
                console.error('[ERROR] Erro ao destruir cliente:', error);
            }
            client = null;
        }
        
        // Inicializar um novo cliente
        initializeClient();
    }, delay);
}

// Função de verificação de saúde do cliente
function checkClientHealth() {
    const currentTime = Date.now();
    const inactiveTime = currentTime - lastActivity;
    
    // Se o cliente está inicializado
    if (client) {
        // Verificar inatividade (10 minutos sem atividade)
        if (inactiveTime > 600000) { // 10 minutos
            console.log('[WARNING] Cliente inativo por muito tempo, executando health check');
            
            // Atualizar timestamp de atividade para evitar múltiplas verificações
            lastActivity = currentTime;
            
            if (connectionStatus === 'ready') {
                // Verificar estado do cliente
                client.getState()
                    .then(state => {
                        console.log('[INFO] Estado do cliente:', state);
                        // Se não está conectado, tentar reconectar
                        if (state !== 'CONNECTED') {
                            console.log('[WARNING] Cliente não está conectado, tentando reconectar');
                            scheduleReconnect(5000); // 5 segundos
                        }
                    })
                    .catch(error => {
                        console.error('[ERROR] Erro ao verificar estado do cliente:', error);
                        // Se ocorreu erro ao verificar estado, provável que a conexão esteja ruim
                        console.log('[WARNING] Erro ao verificar estado, tentando reconectar');
                        scheduleReconnect(5000); // 5 segundos
                    });
            } else if (inactiveTime > 1800000) { // 30 minutos
                // Se inativo por mais de 30 minutos e não está no estado 'ready', forçar reconexão
                console.log('[WARNING] Cliente inativo por mais de 30 minutos e não está pronto, forçando reconexão');
                scheduleReconnect(5000); // 5 segundos
            }
        }
        
        // Pings periódicos para navegador para manter conexão viva
        if (connectionStatus === 'ready' && sessionActive) {
            // A cada 5 minutos, execute uma ação para manter o browser ativo
            if (currentTime % 300000 < 10000) { // Aproximadamente a cada 5 minutos
                try {
                    client.getState()
                        .then(() => {
                            lastActivity = currentTime;
                            console.log('[INFO] Ping de atividade bem-sucedido');
                        })
                        .catch(err => {
                            console.error('[ERROR] Erro ao fazer ping de atividade:', err);
                        });
                } catch (e) {
                    console.error('[ERROR] Exceção ao realizar ping de atividade:', e);
                }
            }
        }
    } else if (inactiveTime > 300000) { // 5 minutos
        // Se não há cliente e estamos inativos há mais de 5 minutos, inicializar
        console.log('[WARNING] Nenhum cliente ativo por mais de 5 minutos, inicializando...');
        initializeClient();
    }
}

// Executar verificação de saúde a cada minuto
setInterval(checkClientHealth, 60000);

// Rotas da API

// Ping para manter a conexão ativa (heartbeat)
app.get('/ping', (req, res) => {
    lastActivity = Date.now();
    res.json({ success: true, timestamp: lastActivity });
});

// Status do serviço
app.get('/status', (req, res) => {
    try {
        // Verificar se a instância do cliente está ativa
        const isActive = !!client;
        
        // Status baseado no estado atual
        const status = {
            status: connectionStatus,
            connected: isActive && (connectionStatus === 'ready' || connectionStatus === 'authenticated'),
            info: connectionInfo,
            phone: connectedPhoneNumber,
            uptime: process.uptime()
        };
        
        res.json(status);
    } catch (error) {
        console.error('[ERROR] Erro ao verificar status:', error);
        res.status(500).json({
            error: error.message,
            connected: false,
            status: 'error'
        });
    }
});

// Iniciar o serviço
app.get('/start', (req, res) => {
    try {
        if (!client) {
            initializeClient();
            res.json({
                success: true,
                message: 'Cliente WhatsApp iniciado'
            });
        } else {
            res.json({
                success: true,
                message: 'Cliente WhatsApp já está ativo'
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao iniciar cliente:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Obter QR code
app.get('/qr', (req, res) => {
    if (qrString) {
        res.json({
            qr_code: qrString
        });
    } else {
        res.status(404).json({
            error: 'QR Code não disponível'
        });
    }
});

// Obter QR code como imagem
app.get('/qr-image', (req, res) => {
    try {
        if (fs.existsSync(qrImagePath)) {
            res.sendFile(qrImagePath);
        } else {
            res.status(404).send('QR Code não disponível');
        }
    } catch (error) {
        console.error('[ERROR] Erro ao enviar imagem de QR code:', error);
        res.status(500).send('Erro interno');
    }
});

// Gerar QR code de teste (para diagnóstico)
app.get('/generate-test-qr', (req, res) => {
    const testData = 'https://example.com/test-' + Date.now();
    qrcode.toDataURL(testData, (err, url) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ qr_code: url });
        }
    });
});

// Enviar mensagem
app.post('/send', async (req, res) => {
    try {
        // Verificar se cliente está pronto
        if (!client || connectionStatus !== 'ready') {
            return res.status(503).json({
                success: false,
                error: `Cliente WhatsApp não está pronto (status: ${connectionStatus})`
            });
        }
        
        const { jid, text, metadata } = req.body;
        
        if (!jid || !text) {
            return res.status(400).json({
                success: false,
                error: 'jid e text são obrigatórios'
            });
        }
        
        console.log(`[INFO] Enviando mensagem para ${jid}: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`);
        
        // Atualizar timestamp de atividade
        lastActivity = Date.now();
        
        // Formatar o número se necessário
        let chatId = jid;
        if (!jid.includes('@')) {
            // Adicionar sufixo para números de telefone
            chatId = `${jid}@c.us`;
        }
        
        try {
            // Tentar enviar mensagem com até 3 tentativas
            let success = false;
            let error = null;
            let attemptCount = 0;
            
            while (!success && attemptCount < 3) {
                attemptCount++;
                try {
                    // Tentar enviar mensagem
                    await client.sendMessage(chatId, text);
                    success = true;
                } catch (sendError) {
                    error = sendError;
                    console.error(`[ERROR] Tentativa ${attemptCount} falhou ao enviar mensagem:`, sendError);
                    
                    // Se o erro for relacionado a uma sessão fechada, tentar refechar a página e reconectar
                    if (sendError.message.includes('Session closed') || 
                        sendError.message.includes('browser has been closed') || 
                        sendError.message.includes('not connected') ||
                        sendError.message.includes('Protocol error')) {
                        
                        console.log('[WARNING] Detectado erro de sessão, tentando corrigir antes da próxima tentativa...');
                        
                        // Verificar estado atual
                        try {
                            const state = await client.getState();
                            console.log(`[INFO] Estado atual: ${state}`);
                            
                            if (state !== 'CONNECTED') {
                                throw new Error('Estado não é CONNECTED');
                            }
                        } catch (stateErr) {
                            console.error('[ERROR] Erro ao verificar estado:', stateErr);
                            // Se não conseguir verificar o estado, tentar reiniciar o cliente
                            if (attemptCount >= 2) {
                                scheduleReconnect(1000); // Última tentativa
                                await new Promise(resolve => setTimeout(resolve, 5000));
                            }
                        }
                    }
                    
                    // Esperar antes da próxima tentativa
                    if (!success && attemptCount < 3) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
            
            if (success) {
                res.json({
                    success: true,
                    message: 'Mensagem enviada com sucesso'
                });
            } else {
                // Informar cliente sobre o erro após todas as tentativas
                res.status(500).json({
                    success: false,
                    error: error ? error.message : 'Falha após múltiplas tentativas'
                });
                
                // Se não conseguiu enviar depois de várias tentativas, reconectar
                scheduleReconnect(10000); // 10 segundos
            }
        } catch (error) {
            console.error('[ERROR] Erro ao enviar mensagem:', error);
            
            // Outros erros
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao processar solicitação de envio:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enviar imagem
app.post('/send-image', upload.single('file'), async (req, res) => {
    try {
        // Verificar se cliente está pronto
        if (!client || connectionStatus !== 'ready') {
            return res.status(503).json({
                success: false,
                error: `Cliente WhatsApp não está pronto (status: ${connectionStatus})`
            });
        }
        
        const { jid, caption } = req.body;
        
        if (!jid || !req.file) {
            return res.status(400).json({
                success: false,
                error: 'jid e arquivo são obrigatórios'
            });
        }
        
        console.log(`[INFO] Enviando imagem para ${jid}`);
        
        // Atualizar timestamp de atividade
        lastActivity = Date.now();
        
        // Formatar o número se necessário
        let chatId = jid;
        if (!jid.includes('@')) {
            // Adicionar sufixo para números de telefone
            chatId = `${jid}@c.us`;
        }
        
        try {
            // Caminho completo do arquivo
            const filePath = req.file.path;
            
            // Tentar enviar mensagem com até 3 tentativas
            let success = false;
            let error = null;
            let attemptCount = 0;
            
            while (!success && attemptCount < 3) {
                attemptCount++;
                try {
                    // Tentar enviar o arquivo como mídia
                    const media = MessageMedia.fromFilePath(filePath);
                    await client.sendMessage(chatId, media, {
                        caption: caption || ''
                    });
                    success = true;
                } catch (sendError) {
                    error = sendError;
                    console.error(`[ERROR] Tentativa ${attemptCount} falhou ao enviar imagem:`, sendError);
                    
                    // Se o erro for de MessageMedia não definido, tentar importar corretamente
                    if (sendError.message.includes('MessageMedia is not defined')) {
                        try {
                            const { MessageMedia } = require('whatsapp-web.js');
                            const media = MessageMedia.fromFilePath(filePath);
                            await client.sendMessage(chatId, media, {
                                caption: caption || ''
                            });
                            success = true;
                            continue;
                        } catch (mediaErr) {
                            console.error('[ERROR] Erro ao importar MessageMedia:', mediaErr);
                        }
                    }
                    
                    // Se o erro for relacionado a uma sessão fechada
                    if (sendError.message.includes('Session closed') || 
                        sendError.message.includes('browser has been closed') || 
                        sendError.message.includes('not connected') ||
                        sendError.message.includes('Protocol error')) {
                        
                        console.log('[WARNING] Detectado erro de sessão, tentando corrigir antes da próxima tentativa...');
                        
                        // Se na última tentativa, agendar reconexão
                        if (attemptCount >= 2) {
                            scheduleReconnect(1000);
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                    
                    // Esperar antes da próxima tentativa
                    if (!success && attemptCount < 3) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
            
            // Remover arquivo temporário após envio
            try {
                fs.unlinkSync(filePath);
            } catch (unlinkError) {
                console.error('[WARNING] Erro ao remover arquivo temporário:', unlinkError);
            }
            
            if (success) {
                res.json({
                    success: true,
                    message: 'Imagem enviada com sucesso'
                });
            } else {
                // Informar cliente sobre o erro após todas as tentativas
                res.status(500).json({
                    success: false,
                    error: error ? error.message : 'Falha após múltiplas tentativas'
                });
                
                // Se não conseguiu enviar depois de várias tentativas, reconectar
                scheduleReconnect(10000); // 10 segundos
            }
        } catch (error) {
            console.error('[ERROR] Erro ao enviar imagem:', error);
            
            // Remover arquivo temporário em caso de erro
            try {
                if (req.file && req.file.path) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (unlinkError) {
                console.error('[WARNING] Erro ao remover arquivo temporário:', unlinkError);
            }
            
            // Outros erros
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao processar solicitação de envio de imagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter informações de um contato
app.get('/contact-info/:phone', async (req, res) => {
    try {
        // Verificar se cliente está pronto
        if (!client || connectionStatus !== 'ready') {
            return res.status(503).json({
                success: false,
                error: `Cliente WhatsApp não está pronto (status: ${connectionStatus})`,
                is_saved: false,
                contact_name: ""
            });
        }
        
        const phone = req.params.phone;
        
        // Formatar o número de telefone
        let chatId = phone;
        if (!phone.includes('@')) {
            chatId = `${phone}@c.us`;
        }
        
        // Atualizar timestamp de atividade
        lastActivity = Date.now();
        
        try {
            // Tentar buscar contato
            const contact = await client.getContactById(chatId);
            
            // Verificar se o contato existe e tem um nome
            const isSaved = !!contact.name && contact.name !== '';
            
            res.json({
                success: true,
                is_saved: isSaved,
                contact_name: contact.name || "",
                contact_info: {
                    number: contact.number,
                    pushname: contact.pushname,
                    isGroup: contact.isGroup,
                    isWAContact: contact.isWAContact
                }
            });
        } catch (contactError) {
            console.error('[ERROR] Erro ao buscar contato:', contactError);
            res.json({
                success: false,
                error: contactError.message,
                is_saved: false,
                contact_name: ""
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao processar solicitação de informações de contato:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            is_saved: false,
            contact_name: ""
        });
    }
});

// Verificar se contato tem palavra-chave no nome
app.get('/check-keyword/:phone', async (req, res) => {
    try {
        // Verificar se cliente está pronto
        if (!client || connectionStatus !== 'ready') {
            return res.status(503).json({
                success: false,
                error: `Cliente WhatsApp não está pronto (status: ${connectionStatus})`,
                has_keyword: false
            });
        }
        
        const phone = req.params.phone;
        const keyword = req.query.keyword;
        
        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetro keyword é obrigatório',
                has_keyword: false
            });
        }
        
        // Formatar o número de telefone
        let chatId = phone;
        if (!phone.includes('@')) {
            chatId = `${phone}@c.us`;
        }
        
        // Atualizar timestamp de atividade
        lastActivity = Date.now();
        
        try {
            // Tentar buscar contato
            const contact = await client.getContactById(chatId);
            
            // Verificar se o contato tem a palavra-chave no nome
            const contactName = contact.name || "";
            const hasKeyword = contactName.toLowerCase().includes(keyword.toLowerCase());
            
            res.json({
                success: true,
                has_keyword: hasKeyword,
                contact_name: contactName
            });
        } catch (contactError) {
            console.error('[ERROR] Erro ao verificar palavra-chave:', contactError);
            res.json({
                success: false,
                error: contactError.message,
                has_keyword: false
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao processar solicitação de verificação de keyword:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            has_keyword: false
        });
    }
});

// Logout do WhatsApp
app.post('/logout', async (req, res) => {
    try {
        if (client) {
            console.log('[INFO] Desconectando cliente WhatsApp...');
            
            try {
                await client.logout();
                await client.destroy();
            } catch (logoutError) {
                console.error('[ERROR] Erro ao fazer logout:', logoutError);
            }
            
            client = null;
            connectionStatus = 'disconnected';
            connectionInfo = null;
            qrString = null;
            sessionActive = false;
            
            // Limpar QR Code salvo
            try {
                if (fs.existsSync(qrImagePath)) {
                    fs.unlinkSync(qrImagePath);
                }
            } catch (unlinkError) {
                console.error('[WARNING] Erro ao remover imagem QR code:', unlinkError);
            }
            
            res.json({
                success: true,
                message: 'Cliente WhatsApp desconectado com sucesso'
            });
        } else {
            res.json({
                success: true,
                message: 'Cliente WhatsApp já está desconectado'
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao fazer logout:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint de debugging
app.get('/debug', async (req, res) => {
    try {
        // Reunir informações para diagnóstico
        const debug = {
            status: connectionStatus,
            client_initialized: !!client,
            uptime: process.uptime(),
            memory_usage: process.memoryUsage(),
            environment: {
                node_version: process.version,
                platform: process.platform,
                arch: process.arch,
                env_variables: {
                    PUPPETEER_WS_ENDPOINT: process.env.PUPPETEER_WS_ENDPOINT,
                    WEBHOOK_URL: process.env.WEBHOOK_URL,
                    NODE_ENV: process.env.NODE_ENV
                }
            },
            whatsapp: {
                has_qr_code: !!qrString,
                connection_info: connectionInfo,
                phone_number: connectedPhoneNumber,
                last_activity: new Date(lastActivity).toISOString(),
                reconnect_attempts: reconnectAttempts,
                session_active: sessionActive
            }
        };
        
        // Obter mais informações do cliente se estiver conectado
        if (client && connectionStatus === 'ready') {
            try {
                const state = await client.getState();
                debug.whatsapp.state = state;
                
                // Tentar obter dados da versão do WWeb
                if (client.info) {
                    debug.whatsapp.version = client.info.wwebVersion;
                }
            } catch (stateError) {
                debug.whatsapp.state_error = stateError.message;
            }
        }
        
        res.json(debug);
    } catch (error) {
        console.error('[ERROR] Erro ao gerar debug info:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// Corrigir importação de MessageMedia aqui para funcionar no endpoint send-image
try {
    const { MessageMedia } = require('whatsapp-web.js');
    global.MessageMedia = MessageMedia;
} catch (error) {
    console.error('[ERROR] Erro ao importar MessageMedia:', error);
}

// Iniciar o servidor
app.listen(port, () => {
    console.log(`[INFO] Servidor WhatsApp iniciado na porta ${port}`);
    
    // Inicializar cliente WhatsApp
    initializeClient();
});