require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bizSdk = require('facebook-nodejs-business-sdk');
const timeout = require('connect-timeout');

const app = express();
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
}

// --- Multer setup for temporary local storage ---
const upload = multer({ dest: 'temp_uploads/' });

// --- API Routes ---
app.get('/api/accounts', async (req, res) => {
    if (!accessToken) {
        return res.status(400).json({ error: 'Token de acesso não configurado.' });
    }
    try {
        const AdAccount = bizSdk.AdAccount;
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
        const account = new bizSdk.AdAccount(accountId);
        const campaigns = await account.getCampaigns(
            [bizSdk.Campaign.Fields.name, bizSdk.Campaign.Fields.promoted_object],
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
        const adSet = new bizSdk.AdSet(adSetId);
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
        const creativeSpec = JSON.parse(creativeSpecJSON);

        // 1. Upload Ad Video directly from the temporary file path
        const account = new bizSdk.AdAccount(accountId);
        const adVideo = await account.createAdVideo([], {
            [bizSdk.AdVideo.Fields.filepath]: tempFilePath,
            [bizSdk.AdVideo.Fields.name]: 'Video - ' + adName,
        });

        // 2. Create Ad Creative by modifying the template
        const newCreativeSpec = { ...creativeSpec };
        newCreativeSpec.video_data.video_id = adVideo.id;
        delete newCreativeSpec.video_data.image_url; 
        delete newCreativeSpec.video_data.image_hash;

        const creative = await account.createAdCreative(
            {},
            {
                [bizSdk.AdCreative.Fields.name]: 'Criativo - ' + adName,
                [bizSdk.AdCreative.Fields.object_story_spec]: newCreativeSpec
            }
        );

        // 3. Create the Ad
        const ad = await account.createAd(
            [],
            {
                [bizSdk.Ad.Fields.name]: adName,
                [bizSdk.Ad.Fields.adset_id]: campaignId,
                [bizSdk.Ad.Fields.creative]: { creative_id: creative.id },
                [bizSdk.Ad.Fields.status]: bizSdk.Ad.Status.paused
            }
        );

        res.json({ message: 'Anúncio criado com sucesso!', ad_id: ad.id });

    } catch (error) {
        console.error('--- ERRO AO CRIAR ANÚNCIO ---');
        console.error(JSON.stringify(error.response ? error.response.data : error, null, 2));
        res.status(500).json({ error: 'Falha ao criar anúncio.', details: error.message });
    } finally {
        // 4. Clean up the temporary file
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
