/**
 * Build-time OAuth config injected by Bot Studio deploy.
 * Used by the PKCE login flow (token exchange backend on Bot Studio).
 */
export const derivOAuthConfig = {
    clientId: process.env.DERIV_OAUTH_CLIENT_ID || '',
    redirectUri: process.env.DERIV_OAUTH_REDIRECT_URI || '',
    tokenExchangeUrl: process.env.DERIV_TOKEN_EXCHANGE_URL || '',
    wsAppId: process.env.DERIV_WS_APP_ID || '',
};

export const hasBotStudioOAuthConfig = () =>
    Boolean(derivOAuthConfig.clientId && derivOAuthConfig.redirectUri && derivOAuthConfig.tokenExchangeUrl);
