/** Active ROT parallel-copy pair — lead trades, follower mirrors. */
export const ROT_COPY_LEAD_EMAIL = 'briankipngetich085@gmail.com';

export const ROT_COPY_FOLLOWER_EMAILS = ['mutavap64@gmail.com'] as const;

export const ROT_COPY_PRESET_EMAILS = [ROT_COPY_LEAD_EMAIL, ...ROT_COPY_FOLLOWER_EMAILS] as const;
