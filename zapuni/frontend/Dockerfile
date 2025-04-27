FROM node:18-alpine

# Definir diretório de trabalho
WORKDIR /app

# Instalar dependências globais
RUN npm install -g react-scripts

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar os arquivos do projeto
COPY . .

# Definir variável de ambiente para URL da API
ENV REACT_APP_API_URL=http://157.180.23.249:8000

# Construir a aplicação para produção
RUN npm run build

# Instalar serve para servir a aplicação de produção
RUN npm install -g serve

# Expor a porta que a aplicação vai rodar
EXPOSE 3000

# Comando para rodar a aplicação
CMD ["serve", "-s", "build", "-l", "3000"]
