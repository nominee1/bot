const  API_BASE = import.meta.env.PROD 
? 'https://dtraderhub.com' 
: '/api'; // Uses Vite proxy locally

export const checkUserExists = async (email: string) => {
    const response = await fetch(`${API_BASE}/check_user.php?email=${encodeURIComponent(email)}`, {
      credentials: 'include'
    });
    if (!response.ok) throw new Error('User check failed');
    return await response.json();
  };
  
  export const registerUser = async (userData: {
    email: string;
    full_name: string;
    deriv_loginid: string;
    deriv_token: string;
  }) => {
    const response = await fetch(`${API_BASE}/register_user.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(userData)
    });
  
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Registration failed');
    }
    return await response.json();
  };