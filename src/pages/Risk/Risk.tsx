import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './Risk.scss';

const Risk = observer(() => {
    const { ui } = useStore();
    const [isChecked, setIsChecked] = useState(false);
    const [showModal, setShowModal] = useState(false);

    const handleCheckboxChange = () => {
        setIsChecked(!isChecked);
    };

    const handleSubmit = () => {
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
    };

    const handleProceed = () => {
        closeModal();
        // In a real application, you would redirect here:
        // window.location.href = '/dashboard';
    };

    // Close modal when clicking outside
    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            const modal = document.getElementById('confirmationModal');
            if (modal && event.target === modal) {
                closeModal();
            }
        };

        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, []);

    return (
        <div className={`risk-disclosure ${ui.is_dark_mode_on ? 'dark-mode' : ''}`}>
            <h1>Risk Disclaimer</h1>
            
            <div className="disclaimer">
                <p> Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the risks before trading Deriv products.</p>
            </div>
            
            <h2>Risks Involved in Trading Deriv Products</h2>
            <ul>
                <li>You may lose some or all of the money you invest in the trade.</li>
                <li>If your trade involves currency conversion, exchange rates will affect your profit and loss.</li>
            </ul>
            
            <h2>Source of Trading Funds</h2>
            <p>You should never trade with borrowed money or with money that you cannot afford to lose.</p>
            
            <div className="confirmation">
                <div className="checkbox-container">
                    <input 
                        type="checkbox" 
                        id="understand-checkbox"
                        checked={isChecked}
                        onChange={handleCheckboxChange}
                    />
                    <label htmlFor="understand-checkbox">
                        I understand the risks involved in trading Deriv products and acknowledge that I may lose some or all of my invested capital.
                    </label>
                </div>
           
            </div>
            
            <div className="footer">
                <p>This information is provided for educational purposes only and should not be considered as financial advice.</p>
                <p>&copy; {new Date().getFullYear()} Denara. All rights reserved.</p>
            </div>

            {/* Custom Modal */}
            {showModal && (
                <div id="confirmationModal" className="modal">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3 className="modal-title">Confirmation</h3>
                            <span className="close-btn" onClick={closeModal}>&times;</span>
                        </div>
                        <div className="modal-body">
                            <p>Thank you for acknowledging the risks involved in trading Deriv products. You may now proceed to your account.</p>
                            <p>Remember to always trade responsibly and never risk more than you can afford to lose.</p>
                        </div>
                        <div className="modal-footer">
                            <button 
                                className="modal-btn modal-btn-primary" 
                                id="proceedBtn"
                                onClick={handleProceed}
                            >
                                Happy Trading!
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default Risk;