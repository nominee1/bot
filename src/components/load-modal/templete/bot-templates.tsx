import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import Text from '../shared_ui/text';

const BotTemplates = observer(({ templates }) => {
    const { load_modal, dashboard } = useStore();

    const handlePreview = (xml_content) => {
        if (load_modal?.previewFile) {
            load_modal.previewFile(xml_content);
            dashboard.setPreviewOnPopup(true);
        }
    };

    const handleLoad = (xml_content) => {
        if (load_modal?.loadFileFromLocal) {
            load_modal.loadFileFromLocal(xml_content);
        }
    };

    return (
        <div className='bot-templates'>
            <div className='bot-templates__list'>
                {templates.map((template) => (
                    <div key={template.id} className='bot-templates__item'>
                        <Text as='h3' color='prominent' weight='bold'>
                            {template.name}
                        </Text>
                        <div className='bot-templates__actions'>
                            <button
                                className='dc-btn dc-btn--secondary'
                                onClick={() => handlePreview(template.xml)}
                            >
                                {localize('Preview')}
                            </button>
                            <button
                                className='dc-btn dc-btn--primary'
                                onClick={() => handleLoad(template.xml)}
                            >
                                {localize('Load')}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default BotTemplates;