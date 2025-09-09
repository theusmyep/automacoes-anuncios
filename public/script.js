// Versão final com webhook e upload de thumbnail
document.addEventListener('DOMContentLoaded', () => {
    const loadingSection = document.getElementById('loading-section');
    const adCreationSection = document.getElementById('ad-creation-section');
    const accountSelect = document.getElementById('account-select');
    const campaignSelect = document.getElementById('campaign-select');
    const logElement = document.getElementById('log');
    const adForm = document.getElementById('ad-form');
    let creativeSpec = null; // Variável para armazenar os dados do anúncio modelo

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
                // Após carregar as campanhas, busca os detalhes do último anúncio da primeira campanha
                getLatestAdDetails(campaigns[0].id);
            } else {
                log('Nenhuma campanha ativa encontrada para esta conta.');
            }
        } catch (error) {
            log(`--- ERRO ---`);
            log(error.toString());
        }
    }

    async function getLatestAdDetails(adSetId) {
        log(`Buscando detalhes do último anúncio para o conjunto ${adSetId}...`);
        try {
            const response = await fetch(`/api/latest-ad-details/${adSetId}`);
            const data = await response.json();

            if (!response.ok) {
                creativeSpec = null; // Limpa se houver erro
                throw new Error(data.error || 'Falha ao buscar detalhes do anúncio modelo.');
            }
            
            creativeSpec = data.creative_spec;
            log('Dados do anúncio modelo carregados com sucesso.');

        } catch (error) {
            log(`--- ERRO ---`);
            log(error.toString());
        }
    }

    // Event listener para quando o usuário troca de campanha
    campaignSelect.addEventListener('change', (event) => {
        const selectedAdSetId = event.target.value;
        getLatestAdDetails(selectedAdSetId);
    });

    adForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        if (!creativeSpec) {
            log('--- ERRO ---');
            log('Não foi possível carregar os dados do anúncio modelo. Tente selecionar outra campanha ou verifique se ela possui anúncios.');
            return;
        }

        log('Iniciando criação do anúncio...');
        const formData = new FormData(adForm);
        // Adiciona os dados do anúncio modelo ao formulário
        formData.append('creative-spec', JSON.stringify(creativeSpec));
        // O FormData já pega os arquivos dos inputs 'creative-file' e 'thumbnail-file'

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
