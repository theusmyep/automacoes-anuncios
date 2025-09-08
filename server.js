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
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const AdCreativeObjectStorySpec = bizSdk.AdCreativeObjectStorySpec;
const AdCreativeVideoData = bizSdk.AdCreativeVideoData;

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
        return res.status(400).json({ error: 'Nenhum arquivo de criativo enviado.' });
    }

    const tempFilePath = req.file.path;

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'account-select': accountId, 'creative-spec': creativeSpecJSON } = req.body;
        const creativeSpecTemplate = JSON.parse(creativeSpecJSON);

        // 1. Manual Video Upload using Axios, requesting automatic thumbnail
        const form = new FormData();
        form.append('access_token', accessToken);
        form.append('thumb_scrape_method', 'default_image');
        form.append('source', fs.createReadStream(tempFilePath), {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });
        
        const uploadResponse = await axios.post(
            `https://graph.facebook.com/v20.0/${accountId}/advideos`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 600000 // 10 minutes timeout
            }
        );
        const adVideoId = uploadResponse.data.id;

        // 2. Poll for video processing status
        // ... (a lógica de polling permanece a mesma)

        // 3. Create a NEW, CLEAN Ad Creative using the template
        const newCreativeSpec = {
            [AdCreativeObjectStorySpec.Fields.page_id]: creativeSpecTemplate.page_id,
            [AdCreativeObjectStorySpec.Fields.video_data]: {
                ...creativeSpecTemplate.video_data,
                [AdCreativeVideoData.Fields.video_id]: adVideoId,
            }
        };
        if (creativeSpecTemplate.instagram_actor_id) {
            newCreativeSpec[AdCreativeObjectStorySpec.Fields.instagram_actor_id] = creativeSpecTemplate.instagram_actor_id;
        }
        delete newCreativeSpec.video_data.image_url;
        delete newCreativeSpec.video_data.image_hash;

        const account = new AdAccount(accountId);
        const creative = await account.createAdCreative({}, {
            [AdCreative.Fields.name]: 'Criativo - ' + adName,
            [AdCreative.Fields.object_story_spec]: newCreativeSpec
        });

        // 4. Create the Ad
        const ad = await account.createAd([], {
            [Ad.Fields.name]: adName,
            [Ad.Fields.adset_id]: campaignId,
            [Ad.Fields.creative]: { creative_id: creative.id },
            [Ad.Fields.status]: Ad.Status.paused
        });

        res.json({ message: 'Anúncio criado com sucesso!', ad_id: ad.id });

    } catch (error) {
        console.error('--- ERRO AO CRIAR ANÚNCIO ---');
        const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
        console.error(errorMessage);
        res.status(500).json({ error: 'Falha ao criar anúncio.', details: errorMessage });
    } finally {
        // 5. Clean up the temporary file
        fs.unlink(tempFilePath, (err) => {
            if (err) console.error('Erro ao deletar arquivo temporário:', err);
        });
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
