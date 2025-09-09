// Versão final simplificada (apenas vídeo)
document.addEventListener('DOMContentLoaded', () => {
    const loadingSection = document.getElementById('loading-section');
    const adCreationSection = document.getElementById('ad-creation-section');
    const accountSelect = document.getElementById('account-select');
    const campaignSelect = document.getElementById('campaign-select');
    const logElement = document.getElementById('log');
    const adForm = document.getElementById('ad-form');

    function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        logElement.innerHTML += `[${timestamp}] ${message}\n`;
        logElement.scrollTop = logElement.scrollHeight;
    }

    async function initialize() {
        log('Iniciando conexão com o Facebook...');
        try {
            const response = await fetch('/api/accounts');
            const accounts = await response.json();

            if (!response.ok) {
                throw new Error(accounts.details || 'Falha ao carregar contas.');
            }

            log('Contas de anúncio carregadas com sucesso!');
            loadingSection.classList.add('hidden');
            adCreationSection.classList.remove('hidden');

            if (accounts.length > 0) {
                accounts.forEach(account => {
                    const option = document.createElement('option');
                    option.value = account.id;
                    option.textContent = account.name;
                    accountSelect.appendChild(option);
                });
                accountSelect.addEventListener('change', () => {
                    loadCampaigns(accountSelect.value);
                });
                loadCampaigns(accounts[0].id);
            } else {
                log('Nenhuma conta de anúncio encontrada.');
            }
        } catch (error) {
            log(`--- ERRO ---`);
            log(error.toString());
        }
    }

    async function loadCampaigns(accountId) {
        log(`Carregando campanhas para a conta ${accountId}...`);
        try {
            const response = await fetch(`/api/campaigns/${accountId}`);
            const campaigns = await response.json();

            if (!response.ok) {
                throw new Error(campaigns.details || 'Falha ao carregar campanhas.');
            }

            campaignSelect.innerHTML = '';
            if (campaigns.length > 0) {
                campaigns.forEach(campaign => {
                    const option = document.createElement('option');
                    option.value = campaign.id;
                    option.textContent = campaign.name;
                    campaignSelect.appendChild(option);
                });
                log('Campanhas carregadas.');
            } else {
                log('Nenhuma campanha ativa encontrada para esta conta.');
            }
        } catch (error) {
            log(`--- ERRO ---`);
            log(error.toString());
        }
    }

    adForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        log('Iniciando criação do anúncio...');
        const formData = new FormData(adForm);

        try {
            const response = await fetch('/api/create-ad', {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Falha ao disparar o webhook.');
            }
            log(result.message);
        } catch (error) {
            log(`--- ERRO ---`);
            log(error.toString());
        }
    });

    initialize();
});
