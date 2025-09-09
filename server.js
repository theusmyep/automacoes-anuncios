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
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;
const AdSet = bizSdk.AdSet;
if (accessToken) {
    bizSdk.FacebookAdsApi.init(accessToken);
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
// ... (as rotas GET permanecem as mesmas)

const uploadFields = [
    { name: 'creative-file', maxCount: 1 },
    { name: 'thumbnail-file', maxCount: 1 }
];

app.post('/api/create-ad', timeout('600s'), upload.fields(uploadFields), async (req, res) => {
    if (!req.files || !req.files['creative-file'] || !req.files['thumbnail-file']) {
        return res.status(400).json({ error: 'Vídeo e thumbnail são obrigatórios.' });
    }

    const videoFile = req.files['creative-file'][0];
    const thumbnailFilePath = req.files['thumbnail-file'][0].path;

    try {
        const { 'campaign-select': campaignId, 'ad-name': adName, 'account-select': accountId, 'creative-spec': creativeSpecJSON } = req.body;
        const creativeSpecTemplate = JSON.parse(creativeSpecJSON);

        // 1. Upload Thumbnail to get image_hash
        const thumbForm = new FormData();
        thumbForm.append('access_token', accessToken);
        thumbForm.append('source', fs.createReadStream(thumbnailFilePath), { filename: req.files['thumbnail-file'][0].originalname, contentType: req.files['thumbnail-file'][0].mimetype });
        const thumbResponse = await axios.post(`https://graph.facebook.com/v20.0/${accountId}/adimages`, thumbForm, { headers: thumbForm.getHeaders() });
        const imageHash = thumbResponse.data.images[Object.keys(thumbResponse.data.images)[0]].hash;

        // 2. Upload Video to Minio
        const videoFileName = `${Date.now()}-${videoFile.originalname}`;
        await minioClient.putObject(bucketName, videoFileName, fs.createReadStream(videoFile.path), videoFile.size);
        const videoPublicUrl = `https://${process.env.MINIO_ENDPOINT}/${bucketName}/${videoFileName}`;

        // 3. Create Ad Video in Facebook using the Minio URL
        const account = new AdAccount(accountId);
        const adVideo = await account.createAdVideo([], {
            [bizSdk.AdVideo.Fields.file_url]: videoPublicUrl,
            [bizSdk.AdVideo.Fields.name]: 'Video - ' + adName,
        });

        // 4. Poll for video processing status
        // ... (lógica de polling)

        // 5. Create Ad Creative
        const newCreativeSpec = { ...creativeSpecTemplate };
        newCreativeSpec.video_data.video_id = adVideo.id;
        newCreativeSpec.video_data.image_hash = imageHash;
        delete newCreativeSpec.video_data.image_url;

        const creative = await account.createAdCreative({}, {
            [AdCreative.Fields.name]: 'Criativo - ' + adName,
            [AdCreative.Fields.object_story_spec]: newCreativeSpec
        });

        // 6. Create the Ad
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
        // 7. Clean up temporary files
        fs.unlink(videoFile.path, () => {});
        fs.unlink(thumbnailFilePath, () => {});
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
