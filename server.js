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
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;

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
            [Campaign.Fields.name, Campaign.Fields.promoted_object],
            { effective_status: ['ACTIVE'] }
        );
        const campaignsData = campaigns.map(campaign => ({
            id: campaign.id,
            name: campaign.name,
            page_id: campaign.promoted_object ? campaign.promoted_object.page_id : null
        }));
        res.json(campaignsData);
    } catch (error) {
        console.error('--- ERRO AO BUSCAR CAMPANHAS ---', JSON.stringify(error, null, 2));
        res.status(500).json({ error: 'Falha ao buscar campanhas.', details: error.message });
    }
});

app.get('/api/latest-ad-details/:adSetId', async (req, res) => {
    try {
        const { adSetId } = req.params;
        const adSet = new AdSet(adSetId);
        const ads = await adSet.getAds(
            ['id', 'name', 'creative{object_story_spec}'],
            { limit: 1, date_preset: 'last_year' }
        );

        if (ads.length === 0) {
            return res.status(404).json({ error: 'Nenhum anúncio encontrado neste conjunto para usar como modelo.' });
        }
        
        const latestAd = ads[0];
        res.json({
            creative_spec: latestAd.creative.object_story_spec
        });

    } catch (error) {
        console.error('--- ERRO AO BUSCAR DETALHES DO ÚLTIMO ANÚNCIO ---', JSON.stringify(error.response ? error.response.data : error, null, 2));
        res.status(500).json({ error: 'Falha ao buscar detalhes do último anúncio.', details: error.message });
    }
});

app.post('/api/create-ad', timeout('600s'), upload.single('creative-file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum vídeo enviado.' });
    }

    const videoFilePath = req.file.path;

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'account-select': accountId, 'creative-spec': creativeSpecJSON } = req.body;
        const creativeSpecTemplate = JSON.parse(creativeSpecJSON);

        // 1. Upload Video to get video_id
        const videoForm = new FormData();
        videoForm.append('access_token', accessToken);
        videoForm.append('source', fs.createReadStream(videoFilePath), { filename: req.file.originalname, contentType: req.file.mimetype });
        const videoResponse = await axios.post(`https://graph.facebook.com/v20.0/${accountId}/advideos`, videoForm, { headers: videoForm.getHeaders(), timeout: 600000 });
        const adVideoId = videoResponse.data.id;

        // 2. Create Ad Creative using the template and new video
        const account = new AdAccount(accountId);
        const newCreativeSpec = { ...creativeSpecTemplate };
        newCreativeSpec.video_data.video_id = adVideoId;
        delete newCreativeSpec.video_data.image_url;
        delete newCreativeSpec.video_data.image_hash;

        const creative = await account.createAdCreative({}, {
            [AdCreative.Fields.name]: 'Criativo - ' + adName,
            [AdCreative.Fields.object_story_spec]: newCreativeSpec
        });

        // 3. Create the Ad
        const adCreationUrl = `https://graph.facebook.com/v20.0/${accountId}/ads`;
        const adCreationData = {
            name: adName,
            adset_id: campaignId,
            creative: { creative_id: creative.id },
            status: 'PAUSED',
            access_token: accessToken,
        };
        const adResponse = await axios.post(adCreationUrl, adCreationData);

        res.json({ message: 'Anúncio criado com sucesso!', ad_id: adResponse.data.id });

    } catch (error) {
        console.error('--- ERRO AO CRIAR ANÚNCIO ---');
        const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
        console.error(errorMessage);
        res.status(500).json({ error: 'Falha ao criar anúncio.', details: errorMessage });
    } finally {
        // 4. Clean up temporary file
        fs.unlink(videoFilePath, (err) => { if (err) console.error('Erro ao deletar vídeo temporário:', err); });
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
