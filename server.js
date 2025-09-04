require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const bizSdk = require('facebook-nodejs-business-sdk');

const app = express();
const port = process.env.PORT || 8081;

// Facebook SDK
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const appSecret = process.env.FACEBOOK_APP_SECRET;
const appId = process.env.FACEBOOK_APP_ID;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
}

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const timeout = require('connect-timeout');

// API routes
app.get('/api/accounts', async (req, res) => {
    if (!accessToken) {
        return res.status(400).json({ error: 'Token de acesso não configurado.' });
    }
    try {
        const AdAccount = bizSdk.AdAccount;
        const me = new bizSdk.User('me');
        let allAccounts = [];
        let adAccounts = await me.getAdAccounts([AdAccount.Fields.name, AdAccount.Fields.id], { limit: 100 });
        allAccounts = allAccounts.concat(adAccounts.map(acc => ({ id: acc.id, name: acc.name })));

        while (adAccounts.hasNext()) {
            adAccounts = await adAccounts.next();
            allAccounts = allAccounts.concat(adAccounts.map(acc => ({ id: acc.id, name: acc.name })));
        }
        
        res.json(allAccounts);
    } catch (error) {
        if (error.response && error.response.error.code === 190) {
            try {
                const newAccessToken = await bizSdk.FacebookAdsApi.getAccessToken(appId, appSecret, accessToken);
                console.log('Novo token de acesso gerado:', newAccessToken);
                // Aqui, em uma aplicação real, você salvaria o novo token no .env
                res.status(500).json({ error: 'Token de acesso expirado. Um novo token foi gerado no console do servidor. Por favor, atualize o .env e reinicie.' });
            } catch (e) {
                console.error('--- ERRO AO GERAR NOVO TOKEN ---');
                console.error(JSON.stringify(e, null, 2));
                res.status(500).json({ error: 'Falha ao gerar novo token de acesso.', details: e.message });
            }
        } else {
            console.error('--- ERRO DETALHADO DA API DO FACEBOOK ---');
            console.error(JSON.stringify(error, null, 2));
            res.status(500).json({ error: 'Falha ao buscar contas de anúncio.', details: error.message });
        }
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
        console.error('--- ERRO AO BUSCAR CAMPANHAS ---');
        console.error(JSON.stringify(error, null, 2));
        res.status(500).json({ error: 'Falha ao buscar campanhas.', details: error.message });
    }
});

app.post('/api/create-ad', timeout('600s'), upload.single('creative-file'), async (req, res) => {
    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'page-id': pageId, 'account-select': accountId } = req.body;
        const creativePath = req.file.path;

        const account = new bizSdk.AdAccount(accountId);
        
        // 1. Upload do criativo
        const creative = await account.createAdCreative(
            {},
            {
                [bizSdk.AdCreative.Fields.name]: 'Criativo - ' + adName,
                [bizSdk.AdCreative.Fields.object_story_spec]: {
                    [bizSdk.AdCreativeObjectStorySpec.Fields.page_id]: pageId,
                    [bizSdk.AdCreativeObjectStorySpec.Fields.video_data]: {
                        [bizSdk.AdCreativeVideoData.Fields.image_url]: 'https://www.facebook.com/images/games/uno/uno_icon.png', // Placeholder
                        [bizSdk.AdCreativeVideoData.Fields.video_id]: (await account.createAdVideo([], { [bizSdk.AdVideo.Fields.filepath]: creativePath })).id
                    }
                }
            }
        );

        // 2. Criação do anúncio
        account.createAd(
            [],
            {
                [bizSdk.Ad.Fields.name]: adName,
                [bizSdk.Ad.Fields.adset_id]: campaignId, // Assumindo que o ID da campanha é o ID do adset
                [bizSdk.Ad.Fields.creative]: { creative_id: creative.id },
                [bizSdk.Ad.Fields.status]: bizSdk.Ad.Status.paused
            }
        );

        res.json({ message: 'Anúncio enviado para processamento!', ad_id: 'Pendente' });
    } catch (error) {
        console.error('--- ERRO AO CRIAR ANÚNCIO ---');
        console.error(JSON.stringify(error, null, 2));
        res.status(500).json({ error: 'Falha ao criar anúncio.', details: error.message });
    }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
