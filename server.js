require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bizSdk = require('facebook-nodejs-business-sdk');
const axios = require('axios');
const FormData = require('form-data');
const timeout = require('connect-timeout');

const app = express();
app.use(express.json());
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
}

// --- Multer setup for temporary local storage ---
const upload = multer({ dest: os.tmpdir() });

// --- API Routes ---
app.get('/api/accounts', async (req, res) => {
    if (!accessToken) {
        return res.status(400).json({ error: 'Token de acesso não configurado.' });
    }
    try {
        const me = new bizSdk.User('me');
        const adAccounts = await me.getAdAccounts([AdAccount.Fields.name, AdAccount.Fields.id]);
        res.json(adAccounts.map(acc => ({ id: acc.id, name: acc.name })));
    } catch (error) {
        console.error('--- ERRO AO BUSCAR CONTAS ---', JSON.stringify(error, null, 2));
        res.status(500).json({ error: 'Falha ao buscar contas de anúncio.', details: error.message });
    }
});

app.get('/api/campaigns/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const account = new AdAccount(accountId);
        const campaigns = await account.getCampaigns(
            [Campaign.Fields.name],
            { effective_status: ['ACTIVE'] }
        );
        const campaignsData = campaigns.map(campaign => ({
            id: campaign.id,
            name: campaign.name,
        }));
        res.json(campaignsData);
    } catch (error) {
        console.error('--- ERRO AO BUSCAR CAMPANHAS ---', JSON.stringify(error, null, 2));
        res.status(500).json({ error: 'Falha ao buscar campanhas.', details: error.message });
    }
});

// --- Rota Principal (envia apenas o vídeo para o n8n) ---
app.post('/api/create-ad', upload.single('creative-file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum vídeo enviado.' });
    }

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'account-select': accountId } = req.body;
        const n8nWebhookUrl = 'https://auto.theusm.com.br/webhook/subir-anuncios-geral';

        const form = new FormData();
        form.append('accountId', accountId);
        form.append('campaignId', campaignId);
        form.append('adName', adName);
        form.append('video', fs.createReadStream(req.file.path), { filename: req.file.originalname });

        // Dispara o webhook do n8n
        await axios.post(n8nWebhookUrl, form, { headers: form.getHeaders() });

        res.json({ message: 'Processamento iniciado. O anúncio será criado em segundo plano pelo n8n.' });

    } catch (error) {
        console.error('--- ERRO AO DISPARAR WEBHOOK ---', error.message);
        res.status(500).json({ error: 'Falha ao iniciar o processo de criação do anúncio.' });
    } finally {
        // Limpa o arquivo temporário
        fs.unlink(req.file.path, () => {});
    }
});

// --- Static Files & Fallback ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${port}`);
});
