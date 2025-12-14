export interface DerivUserPayload {
    email: string;
    loginId: string;
    fullName: string;
  }
  
  export async function saveDerivUser({
    email,
    loginId,
    fullName,
  }: DerivUserPayload): Promise<void> {
    await fetch('/api/save_deriv_user.php', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email,
        login_id : loginId,
        full_name: fullName,
      }),
    });
  }
  