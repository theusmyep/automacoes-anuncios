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

// --- SDK and Client Initialization with Error Handling ---
let minioClient;
const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const AdAccount = bizSdk.AdAccount;
const AdSet = bizSdk.AdSet;
const AdCreative = bizSdk.AdCreative;
const Ad = bizSdk.Ad;

try {
    console.log('Iniciando a inicialização do servidor...');

    if (!accessToken) {
        throw new Error('FATAL: FACEBOOK_ACCESS_TOKEN não está definido nas variáveis de ambiente.');
    }
    bizSdk.FacebookAdsApi.init(accessToken);
    console.log('SDK do Facebook inicializado com sucesso.');

    minioClient = new Minio.Client({
        endPoint: process.env.MINIO_ENDPOINT,
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY
    });
    console.log('Cliente Minio configurado.');

} catch (startupError) {
    console.error('--- ERRO FATAL DE INICIALIZAÇÃO ---');
    console.error(startupError.message);
    console.error('O servidor não pôde ser iniciado.');
    process.exit(1); // Encerra o processo com um código de erro
}

const bucketName = process.env.MINIO_BUCKET_NAME;
const upload = multer({ dest: os.tmpdir() });

// --- API Routes ---
// ... (as rotas GET permanecem as mesmas)

app.post('/api/create-ad', timeout('1200s'), upload.array('creative-files'), async (req, res) => {
    // ... (código de criação de anúncio existente)
});

// --- Static Files & Fallback ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${port}`);
});
