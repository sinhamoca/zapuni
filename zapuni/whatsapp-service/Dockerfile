FROM node:20-slim

# Instalar dependências mínimas necessárias 
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    wget \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Criar e configurar diretório da aplicação
WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar todo o código-fonte
COPY . .

# Criar diretórios necessários
RUN mkdir -p /app/.wwebjs_auth \
    && mkdir -p /app/logs \
    && chmod -R 777 /app/.wwebjs_auth \
    && chmod -R 777 /app/logs

# Configurar variáveis de ambiente
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

# Expor porta para o servidor web
EXPOSE 8080

# Iniciar aplicação
CMD ["node", "whatsapp-remote.js"]
