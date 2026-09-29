import { localize } from '@deriv-com/translations';
import { config } from '../constants/config';

/**
 * Icon / label key for trade type. CALL/PUT alone are ambiguous (Rise/Fall vs Higher/Lower) —
 * resolve from shortcode / longcode so Higher never paints as Rise.
 */
export const resolveTradeTypeIconKey = contract => {
    const type = String(contract?.contract_type || '')
        .trim()
        .toUpperCase();
    if (type === 'HIGHER' || type === 'LOWER') return type;

    const shortcode = String(contract?.shortcode || '');
    const shortcode_head = shortcode.split('_')[0] || '';
    if (shortcode_head === 'HIGHER' || shortcode_head === 'LOWER') return shortcode_head;

    const longcode = String(contract?.longcode || '');
    if (/strictly higher than entry spot plus/i.test(longcode) || /higher than entry spot plus/i.test(longcode)) {
        return 'HIGHER';
    }
    if (/strictly lower than entry spot plus/i.test(longcode) || /lower than entry spot plus/i.test(longcode)) {
        return 'LOWER';
    }

    // Hedge merge used to join types as "HIGHER+LOWER" — recover the leg from shortcode/longcode.
    if (type.includes('+')) {
        if (/HIGHER/i.test(shortcode_head) || /strictly higher/i.test(longcode)) return 'HIGHER';
        if (/LOWER/i.test(shortcode_head) || /strictly lower/i.test(longcode)) return 'LOWER';
    }

    if (['CALL', 'PUT'].includes(type)) {
        const shortcode_suffix = shortcode.split('_').slice(-2)[0] || '';
        const is_risefall = /^S0P$/i.test(shortcode_suffix);
        if (!is_risefall && shortcode) {
            return type === 'CALL' ? 'HIGHER' : 'LOWER';
        }
    }

    return type;
};

// TODO: use-shared-functions - These functions are duplicates of trader ones, export and use these instead.
export const getContractTypeName = contract => {
    const { opposites } = config();
    let name = localize('Unknown');

    const resolved_type = resolveTradeTypeIconKey(contract);
    const contract_for_name =
        resolved_type !== contract?.contract_type ? { ...contract, contract_type: resolved_type } : contract;

    Object.keys(opposites).forEach(opposites_name => {
        const contract_type_objs = opposites[opposites_name];

        contract_type_objs.forEach(contract_type_obj => {
            const contract_type_names = Object.entries(contract_type_obj)[0]; // ['CALL', 'Rise']

            if (contract_type_names[0] === contract_for_name.contract_type) {
                // Extra check for CALL & PUT types to distinguish Rise/Fall & Higher/Lower
                // when legacy APIs still return CALL/PUT for both. Newer APIs use HIGHER/LOWER.
                if (['CALL', 'PUT'].includes(contract_type_names[0])) {
                    const shortcode_suffix = String(contract_for_name.shortcode || '')
                        .split('_')
                        .slice(-2)[0];
                    const is_risefall = /^S0P$/.test(shortcode_suffix);
                    const req_opposite_name = is_risefall ? 'CALLPUT' : 'HIGHERLOWER';

                    if (opposites_name !== req_opposite_name) {
                        return;
                    }
                }

                name = contract_type_names[1];
            }
        });
    });

    return name;
};
