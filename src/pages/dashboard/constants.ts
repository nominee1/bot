/** Legacy shape for unused `intro-card` helper — dashboard intro sidebar / `InfoPanel` removed. */
export type TSidebarItem = {
    label: string;
    content: { data: string; faq_id?: string }[];
    link: boolean;
};
