require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const bizSdk = require('facebook-nodejs-business-sdk');
const Minio = require('minio');
const timeout = require('connect-timeout');

const app = express();
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
}

// --- Minio Client Initialization ---
const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT, 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
});
const bucketName = process.env.MINIO_BUCKET_NAME;

// --- Multer setup for in-memory storage ---
const upload = multer({ storage: multer.memoryStorage() });

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

app.post('/api/create-ad', timeout('600s'), upload.single('creative-file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo de criativo enviado.' });
    }

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'page-id': pageId, 'account-select': accountId } = req.body;
        
        // 1. Upload to Minio
        const fileName = `${Date.now()}-${req.file.originalname}`;
        await minioClient.putObject(bucketName, fileName, req.file.buffer, req.file.size);

        // 2. Generate a temporary presigned URL for Facebook to access the file
        const presignedUrl = await minioClient.presignedGetObject(bucketName, fileName, 60 * 60); // URL valid for 1 hour

        // 3. Create Ad Video using the presigned URL
        const account = new bizSdk.AdAccount(accountId);
        const adVideo = await account.createAdVideo([], {
            [bizSdk.AdVideo.Fields.file_url]: presignedUrl,
            [bizSdk.AdVideo.Fields.name]: 'Video - ' + adName,
        });

        // Wait for video to be processed
        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15s, adjust as needed

        // 4. Create Ad Creative
        const creative = await account.createAdCreative(
            {},
            {
                [bizSdk.AdCreative.Fields.name]: 'Criativo - ' + adName,
                [bizSdk.AdCreative.Fields.object_story_spec]: {
                    [bizSdk.AdCreativeObjectStorySpec.Fields.page_id]: pageId,
                    [bizSdk.AdCreativeObjectStorySpec.Fields.video_data]: {
                        [bizSdk.AdCreativeVideoData.Fields.video_id]: adVideo.id,
                        [bizSdk.AdCreativeVideoData.Fields.image_url]: 'https://www.facebook.com/images/games/uno/uno_icon.png', // Placeholder thumbnail
                        [bizSdk.AdCreativeVideoData.Fields.call_to_action]: {
                            type: 'LEARN_MORE',
                            value: { link: 'https://www.facebook.com' }
                        }
                    }
                }
            }
        );

        // 5. Create the Ad
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
