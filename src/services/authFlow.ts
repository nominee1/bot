// src/services/authFlow.ts
import { getRealDerivAccount, fetchDerivUserDetails } from '@/utils/authUtils';
import { checkUserExists, registerUser } from '@/services/apiService';

interface RegistrationResult {
    email: string;
    isNewUser: boolean;
}

export const handleAutoRegistration = async (): Promise<RegistrationResult> => {
    const account = getRealDerivAccount();
    if (!account) throw new Error('No valid Deriv account found');

    const userDetails = await fetchDerivUserDetails(account.token);
    const { exists } = await checkUserExists(userDetails.email);

    if (!exists) {
        await registerUser({
            email: userDetails.email,
            full_name: userDetails.full_name,
            deriv_loginid: account.loginid,
            deriv_token: account.token
        });
    }

    return {
        email: userDetails.email,
        isNewUser: !exists
    };
};

