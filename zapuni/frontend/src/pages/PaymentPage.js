import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { paymentService } from '../api';
import { QrCode, Check, AlertCircle, RefreshCw, Copy, Clock } from 'lucide-react';

const PaymentPage = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  
  const [payment, setPayment] = useState(null);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [redeemCode, setRedeemCode] = useState(null);

  // Gerar pagamento Pix
  useEffect(() => {
    const generatePayment = async () => {
      try {
        setLoading(true);
        const productResponse = await paymentService.getProduct(productId);
        setProduct(productResponse.data);
        
        const paymentResponse = await paymentService.generatePayment(productId);
        setPayment(paymentResponse.data);
        
        // Iniciar contagem regressiva se houver data de expiração
        if (paymentResponse.data.expiration_date) {
          const expDate = new Date(paymentResponse.data.expiration_date);
          const now = new Date();
          const diffMs = expDate - now;
          setCountdown(Math.floor(diffMs / 1000));
        }
        
        setError(null);
      } catch (err) {
        console.error('Erro ao gerar pagamento:', err);
        setError('Não foi possível gerar o pagamento. Tente novamente.');
      } finally {
        setLoading(false);
      }
    };

    generatePayment();
  }, [productId]);

  // Verificar status do pagamento periodicamente
  useEffect(() => {
    let interval;
    
    if (payment && payment.payment_id && paymentStatus !== 'approved') {
      interval = setInterval(async () => {
        try {
          setVerifying(true);
          const response = await paymentService.verifyPayment(payment.payment_id);
          setPaymentStatus(response.data.status);
          
          // Se aprovado, buscar código de resgate
          if (response.data.is_approved && response.data.transaction_id) {
            clearInterval(interval);
            await getRedeemCode(response.data.transaction_id);
          }
        } catch (err) {
          console.error('Erro ao verificar pagamento:', err);
        } finally {
          setVerifying(false);
        }
      }, 5000); // Verificar a cada 5 segundos
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [payment, paymentStatus]);
  
  // Contagem regressiva
  useEffect(() => {
    let timer;
    
    if (countdown !== null && countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    }
    
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  // Buscar código de resgate quando o pagamento for aprovado
  const getRedeemCode = async (transactionId) => {
    try {
      const response = await paymentService.generateRedeemCode(transactionId);
      setRedeemCode(response.data.redeem_code);
    } catch (err) {
      console.error('Erro ao gerar código de resgate:', err);
      setError('Pagamento aprovado, mas não foi possível gerar o código de resgate.');
    }
  };

  // Copiar código Pix para área de transferência
  const copyPixCode = () => {
    navigator.clipboard.writeText(payment.qr_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Formatar tempo restante
  const formatTimeRemaining = () => {
    if (countdown === null || countdown <= 0) return 'Expirado';
    
    const minutes = Math.floor(countdown / 60);
    const seconds = countdown % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Renderizar estado de carregamento
  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  // Renderizar erro
  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 p-6 rounded-lg">
        <div className="flex items-center mb-4">
          <AlertCircle className="mr-2" />
          <h2 className="text-xl font-bold">Erro no Pagamento</h2>
        </div>
        <p>{error}</p>
        <button 
          onClick={() => navigate('/produtos')}
          className="mt-4 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
        >
          Voltar para Produtos
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto bg-white p-6 rounded-lg shadow-md">
      {/* Cabeçalho */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold">Pagamento via PIX</h1>
        {product && (
          <div className="mt-2">
            <h2 className="text-lg">{product.name}</h2>
            <p className="text-xl font-bold text-blue-600">
              R$ {parseFloat(product.price).toFixed(2)}
            </p>
          </div>
        )}
      </div>
      
      {/* Status do Pagamento */}
      <div className={`p-4 rounded-lg mb-6 ${
        paymentStatus === 'approved' ? 'bg-green-100 text-green-800' :
        paymentStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
        'bg-red-100 text-red-800'
      }`}>
        <div className="flex items-center">
          {paymentStatus === 'approved' ? (
            <Check className="mr-2" />
          ) : paymentStatus === 'pending' ? (
            <Clock className="mr-2" />
          ) : (
            <AlertCircle className="mr-2" />
          )}
          <span className="font-medium">
            {paymentStatus === 'approved' ? 'Pagamento Aprovado!' :
             paymentStatus === 'pending' ? 'Aguardando Pagamento' :
             'Pagamento Rejeitado'}
          </span>
          
          {paymentStatus === 'pending' && verifying && (
            <RefreshCw className="ml-2 animate-spin" size={18} />
          )}
        </div>
        
        {countdown !== null && paymentStatus === 'pending' && (
          <div className="mt-2 text-sm">
            Tempo restante: <span className="font-mono">{formatTimeRemaining()}</span>
          </div>
        )}
      </div>
      
      {/* Código de Resgate (se aprovado) */}
      {paymentStatus === 'approved' && redeemCode && (
        <div className="bg-green-50 border border-green-200 p-6 rounded-lg mb-6 text-center">
          <h3 className="text-lg font-bold mb-2">Código de Resgate</h3>
          <div className="bg-white border-2 border-green-500 rounded-lg p-3 mb-3">
            <span className="font-mono text-xl tracking-wider">{redeemCode}</span>
          </div>
          <p className="text-sm text-gray-600">
            Utilize este código no WhatsApp para ativar seu produto
          </p>
          <button 
            onClick={() => navigator.clipboard.writeText(redeemCode)}
            className="mt-3 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center mx-auto"
          >
            <Copy className="mr-2" size={18} /> Copiar Código
          </button>
        </div>
      )}
      
      {/* QR Code (se pendente) */}
      {paymentStatus === 'pending' && payment && (
        <div className="flex flex-col items-center">
          <div className="bg-white border p-4 rounded-lg mb-4">
            {payment.qr_code_base64 && (
              <img 
                src={`data:image/png;base64,${payment.qr_code_base64}`} 
                alt="QR Code PIX" 
                className="w-64 h-64"
              />
            )}
          </div>
          
          <div className="w-full">
            <p className="text-sm text-gray-500 mb-2 text-center">
              Copie o código PIX abaixo ou escaneie o QR Code acima
            </p>
            
            <div className="flex items-center border rounded-lg overflow-hidden mb-4">
              <div className="flex-1 font-mono text-xs p-3 bg-gray-50 overflow-x-auto">
                {payment.qr_code}
              </div>
              <button 
                onClick={copyPixCode}
                className={`px-4 py-3 ${copied ? 'bg-green-500' : 'bg-blue-600'} text-white`}
              >
                {copied ? (
                  <Check size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
          </div>
          
          <div className="text-center text-sm text-gray-500 space-y-1 mt-4">
            <p>1. Abra o aplicativo do seu banco</p>
            <p>2. Escolha pagar via PIX com QR Code</p>
            <p>3. Escaneie o QR Code ou copie e cole o código acima</p>
            <p>4. Confirme o pagamento no app do seu banco</p>
          </div>
        </div>
      )}
      
      {/* Botões de Ação */}
      <div className="mt-6 flex justify-center space-x-4">
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 border rounded hover:bg-gray-50 flex items-center"
        >
          <RefreshCw className="mr-2" size={18} /> Atualizar
        </button>
        
        <button 
          onClick={() => navigate('/produtos')}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Voltar para Produtos
        </button>
      </div>
    </div>
  );
};

export default PaymentPage;
