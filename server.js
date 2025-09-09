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
app.use(express.json()); // Middleware to parse JSON bodies
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const AdAccount = bizSdk.AdAccount;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const AdSet = bizSdk.AdSet;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
}

// --- Multer setup for temporary local storage ---
const upload = multer({ dest: os.tmpdir() });

// --- API Routes (unchanged) ---
app.get('/api/accounts', async (req, res) => {
    // ... (código existente para buscar contas)
});
app.get('/api/campaigns/:accountId', async (req, res) => {
    // ... (código existente para buscar campanhas)
});
app.get('/api/latest-ad-details/:adSetId', async (req, res) => {
    // ... (código existente para buscar detalhes do último anúncio)
});

// --- Rota Principal (agora envia para o n8n) ---
const uploadFields = [
    { name: 'creative-file', maxCount: 1 },
    { name: 'thumbnail-file', maxCount: 1 }
];
app.post('/api/create-ad', upload.fields(uploadFields), async (req, res) => {
    if (!req.files || !req.files['creative-file'] || !req.files['thumbnail-file']) {
        return res.status(400).json({ error: 'Vídeo e thumbnail são obrigatórios.' });
    }

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'account-select': accountId } = req.body;
        const n8nWebhookUrl = 'https://auto.theusm.com.br/webhook/subir-anuncios-geral';

        const form = new FormData();
        form.append('accountId', accountId);
        form.append('campaignId', campaignId);
        form.append('adName', adName);
        form.append('video', fs.createReadStream(req.files['creative-file'][0].path), { filename: req.files['creative-file'][0].originalname });
        form.append('thumbnail', fs.createReadStream(req.files['thumbnail-file'][0].path), { filename: req.files['thumbnail-file'][0].originalname });

        // Dispara o webhook do n8n e não espera por uma resposta
        axios.post(n8nWebhookUrl, form, { headers: form.getHeaders() });

        res.json({ message: 'Processamento iniciado. O anúncio será criado em segundo plano pelo n8n.' });

    } catch (error) {
        console.error('--- ERRO AO DISPARAR WEBHOOK ---', error.message);
        res.status(500).json({ error: 'Falha ao iniciar o processo de criação do anúncio.' });
    } finally {
        // Limpa os arquivos temporários
        fs.unlink(req.files['creative-file'][0].path, () => {});
        fs.unlink(req.files['thumbnail-file'][0].path, () => {});
    }
});

// --- Webhook para o n8n chamar de volta ---
app.post('/webhook/n8n-callback', async (req, res) => {
    try {
        const { videoId, imageHash, accountId, campaignId, adName } = req.body;

        // Lógica de duplicação e criação do anúncio (que já sabemos que funciona)
        const account = new AdAccount(accountId);
        const adSet = new AdSet(campaignId);
        const ads = await adSet.getAds(['creative{object_story_spec}'], { limit: 1 });
        const creativeSpecTemplate = ads[0].creative.object_story_spec;

        const newCreativeSpec = { ...creativeSpecTemplate };
        newCreativeSpec.video_data.video_id = videoId;
        newCreativeSpec.video_data.image_hash = imageHash;
        delete newCreativeSpec.video_data.image_url;

        const creative = await account.createAdCreative({}, {
            name: 'Criativo - ' + adName,
            object_story_spec: newCreativeSpec
        });

        await account.createAd([], {
            name: adName,
            adset_id: campaignId,
            creative: { creative_id: creative.id },
            status: 'PAUSED',
        });

        console.log(`Anúncio ${adName} criado com sucesso via callback.`);
        res.status(200).send('Callback recebido e processado.');

    } catch (error) {
        console.error('--- ERRO NO WEBHOOK CALLBACK ---', error.response ? error.response.data : error.message);
        res.status(500).send('Erro ao processar o callback.');
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
