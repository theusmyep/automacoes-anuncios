require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bizSdk = require('facebook-nodejs-business-sdk');
const axios = require('axios');
const FormData = require('form-data');
const Minio = require('minio');
const timeout = require('connect-timeout');

const app = express();
app.use(express.json());
const port = process.env.PORT || 8081;

// --- Facebook SDK Initialization ---
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const AdAccount = bizSdk.AdAccount;
const AdSet = bizSdk.AdSet;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const FacebookAdsApi = bizSdk.FacebookAdsApi;

if (accessToken) {
    FacebookAdsApi.init(accessToken);
}

// --- Minio Client Initialization ---
const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
});
const bucketName = process.env.MINIO_BUCKET_NAME;

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

app.post('/api/create-ad', timeout('1200s'), upload.array('creative-files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Nenhum vídeo enviado.' });
    }

    const files = req.files;
    let createdAds = [];
    let errors = [];

    try {
        const { 'campaign-select': campaignIds, 'ad-name-prefix': adNamePrefix, 'account-select': accountId, 'ad-status': adStatus } = req.body;
        const campaignsToProcess = Array.isArray(campaignIds) ? campaignIds : [campaignIds];

        for (const file of files) {
            const adName = `${adNamePrefix} - ${path.parse(file.originalname).name}`;
            
            // 1. Upload Video to Minio
            const videoFileName = `${Date.now()}-${file.originalname}`;
            await minioClient.putObject(bucketName, videoFileName, fs.createReadStream(file.path), file.size);
            const videoPublicUrl = `https://${process.env.MINIO_ENDPOINT}/${bucketName}/${videoFileName}`;

            // 2. Create Ad Video in Facebook
            const account = new AdAccount(accountId);
            const adVideo = await account.createAdVideo([], {
                [bizSdk.AdVideo.Fields.file_url]: videoPublicUrl,
                [bizSdk.AdVideo.Fields.name]: adName,
            });

            for (const campaignId of campaignsToProcess) {
                try {
                    // 3. Fetch a valid creative spec to use as a template
                    const adSet = new AdSet(campaignId);
                    const ads = await adSet.getAds(['creative{object_story_spec}'], { limit: 1 });
                    if (ads.length === 0) {
                        throw new Error(`Nenhum anúncio modelo encontrado no conjunto ${campaignId}.`);
                    }
                    const creativeSpecTemplate = ads[0].creative.object_story_spec;

                    // 4. Create Ad Creative
                    const newCreativeSpec = { ...creativeSpecTemplate };
                    newCreativeSpec.video_data.video_id = adVideo.id;
                    delete newCreativeSpec.video_data.image_url;
                    delete newCreativeSpec.video_data.image_hash;

        console.log('Criando criativo com o spec:', JSON.stringify(newCreativeSpec, null, 2));
        const creative = await account.createAdCreative({}, {
            [AdCreative.Fields.name]: 'Criativo - ' + adName,
            [AdCreative.Fields.object_story_spec]: newCreativeSpec
        });

                    // 5. Create the Ad
                    const adCreationUrl = `https://graph.facebook.com/v20.0/${accountId}/ads`;
                    const adCreationData = {
                        name: adName,
                        adset_id: campaignId,
                        creative: { creative_id: creative.id },
                        status: adStatus,
                        access_token: accessToken,
                    };
                    const adResponse = await axios.post(adCreationUrl, adCreationData);
                    createdAds.push(adResponse.data.id);

                } catch (campaignError) {
                    errors.push(`Falha na campanha ${campaignId} para o vídeo ${file.originalname}: ${campaignError.message}`);
                }
            }
        }

        res.json({ 
            message: 'Processo de criação em massa concluído.',
            success: createdAds,
            failures: errors 
        });

    } catch (error) {
        console.error('--- ERRO GERAL AO CRIAR ANÚNCIOS ---', error.message);
        res.status(500).json({ error: 'Falha geral no processo.', details: error.message });
    } finally {
        // 6. Clean up temporary files
        files.forEach(file => fs.unlink(file.path, () => {}));
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
