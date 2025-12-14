interface DerivAccount {
    loginid: string;
    token: string;
    currency: string;
  }
  
  interface UserDetails {
    email: string;
    full_name: string;
  }
  
  const  API_BASE = import.meta.env.PROD 
    ? 'https://dtraderhub.com' 
    : '/api'; // Uses Vite proxy locally
  
  export const getRealDerivAccount = (): DerivAccount | null => {
    try {
      const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
      const clientAccounts = JSON.parse(localStorage.getItem('clientAccounts') || '{}');
      
      // Find first non-VRTC account
      for (const [loginid, account] of Object.entries(clientAccounts)) {
        if (!loginid.startsWith('VRTC')) {
          return {
            loginid,
            token: accountsList[loginid],
            currency: account.currency || 'USD'
          };
        }
      }
      return null;
    } catch (error) {
      console.error('Account parsing error:', error);
      return null;
    }
  };
  
  export const fetchDerivUserDetails = async (token: string): Promise<UserDetails> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3');
      
      ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));
      
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        ws.close();
        data.authorize 
          ? resolve({
              email: data.authorize.email,
              full_name: `${data.authorize.first_name} ${data.authorize.last_name}`
            })
          : reject(new Error(data.error?.message || 'Authorization failed'));
      };
  
      ws.onerror = () => {
        ws.close();
        reject(new Error('WebSocket connection failed'));
      };
    });
  };