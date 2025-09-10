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
const AdSet = bizSdk.AdSet;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const FacebookAdsApi = bizSdk.FacebookAdsApi;

if (accessToken) {
    FacebookAdsApi.init(accessToken);
}

// --- Multer setup for temporary local storage ---
const upload = multer({ dest: os.tmpdir() });

// --- API Routes ---
// ... (as rotas GET permanecem as mesmas)

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
            
            // 1. Upload Video directly to Facebook
            const videoForm = new FormData();
            videoForm.append('access_token', accessToken);
            videoForm.append('source', fs.createReadStream(file.path), { filename: file.originalname, contentType: file.mimetype });
            const videoResponse = await axios.post(`https://graph.facebook.com/v20.0/${accountId}/advideos`, videoForm, { headers: videoForm.getHeaders(), timeout: 600000 });
            const adVideoId = videoResponse.data.id;

            for (const campaignId of campaignsToProcess) {
                try {
                    // 2. Fetch a valid creative spec to use as a template
                    const adSet = new AdSet(campaignId);
                    const ads = await adSet.getAds(['creative{object_story_spec}'], { limit: 1 });
                    if (ads.length === 0) {
                        throw new Error(`Nenhum anúncio modelo encontrado no conjunto ${campaignId}.`);
                    }
                    const creativeSpecTemplate = ads[0].creative.object_story_spec;

                    // 3. Create Ad Creative
                    const account = new AdAccount(accountId);
                    const newCreativeSpec = { ...creativeSpecTemplate };
                    newCreativeSpec.video_data.video_id = adVideoId;
                    delete newCreativeSpec.video_data.image_url;
                    delete newCreativeSpec.video_data.image_hash;

                    const creative = await account.createAdCreative({}, {
                        [AdCreative.Fields.name]: 'Criativo - ' + adName,
                        [AdCreative.Fields.object_story_spec]: newCreativeSpec
                    });

                    // 4. Create the Ad
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
        // 5. Clean up temporary files
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
