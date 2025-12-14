import { localize } from '@deriv-com/translations';

export type TSidebarItem = {
    label: string;
    content: { data: string; faq_id?: string }[];
    link: boolean;
};

export const SIDEBAR_INTRO = (): TSidebarItem[] => [
    {
        label: localize('Welcome to DenaraPro'),
        content: [
            {
                data: localize(
                    '🔴 Powered by deriv🔴'
                ),
            },
            { data: localize('Market analysis tools') },
        ],
        link: false,
    },
    {
        label: localize('Guide'),
        content: [{ data: localize('Learn how to use denara!') }],
        link: true,
    },
    {
        label: localize('FAQs'),
        content: [
            {
                data: localize('What is Bot?'),
                faq_id: 'faq-0',
            },
            {
                data: localize('How do i analyze the market?'),
                faq_id: 'faq-1',
            },
            {
                data: localize('How do i use the bot?'),
                faq_id: 'faq-2',
            },
        ],
        link: true,
    },
];
