# Adicione esta função à classe WhatsAppBot no arquivo whatsapp_integration.py

async def send_image(self, phone_number: str, image_path: str, caption: str = None) -> Dict[str, Any]:
    """
    Envia uma imagem para um número de WhatsApp
    
    :param phone_number: Número de telefone no formato internacional
    :param image_path: Caminho para o arquivo de imagem
    :param caption: Legenda opcional para a imagem
    :return: Resposta da API
    """
    if not phone_number:
        return {"success": False, "error": "Número de telefone não fornecido"}
    
    if not os.path.exists(image_path):
        return {"success": False, "error": f"Arquivo de imagem não encontrado: {image_path}"}
    
    # Formatar o número (remover formatação e manter apenas dígitos)
    formatted_number = ''.join(filter(str.isdigit, phone_number))
    
    try:
        # Ler o arquivo de imagem
        with open(image_path, "rb") as image_file:
            files = {
                'file': (os.path.basename(image_path), image_file, 'image/jpeg')
            }
            
            # Preparar os dados de formulário
            data = {
                'jid': formatted_number
            }
            
            # Adicionar legenda se fornecida
            if caption:
                data['caption'] = caption
            
            logger.info(f"Enviando imagem para {formatted_number}")
            
            # Enviar requisição para o endpoint de envio de imagem
            response = requests.post(
                f"{self.service_url}/send-image", 
                data=data,
                files=files,
                timeout=15
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"Imagem enviada com sucesso: {result}")
                return {"success": True, "data": result}
            else:
                logger.error(f"Erro ao enviar imagem. Status: {response.status_code}, Resposta: {response.text}")
                return {"success": False, "error": f"Erro HTTP {response.status_code}: {response.text}"}
                
        except Exception as e:
            logger.error(f"Exceção ao enviar imagem: {str(e)}")
            return {"success": False, "error": str(e)}