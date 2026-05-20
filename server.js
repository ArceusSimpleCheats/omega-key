const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const keys = new Map();
const oneTimeTokens = new Map();
const cooldown = new Map();

function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

const PREMIUM_KEYS = [
    "p7f3a8d2c9e1b4f6a0c8e3d5b7f9a2c4",
    "p9c2e5b8a1d4f7c0e3a6b9d2f5c8e1b4",
    "pa3f6c9e2b5d8a1c4f7e0d3b6a9c2f5e",
    "pb4e7a1d4f8c2b5e9d0a3c6f9e2b5d8a",
    "pc5f8b2e5a9d3c6f0b4e7a0c3f6d9b2e",
    "pd6a9c3f6b1e4d7a2c5f8e1b4d7a0c3f",
    "pe7b0d4a7c2f5e8b3d6a9c2e5f8b1d4a",
    "pf8c1e5b8d3a6f9c4e7b0d3a6f9c2e5b",
    "pg9d2f6c9e4b7a0d5e8c1f4a7b0d3e6c",
    "ph0e3a7d0b5c8f1e6d9b2e5a8c1f4d7a"
];

PREMIUM_KEYS.forEach(key => {
    keys.set(key, { deviceId: null, expiresAt: null, type: 'premium' });
});

function createNormalKey(deviceId) {
    const key = generateKey();
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000);
    keys.set(key, { deviceId, expiresAt, type: 'normal' });
    return key;
}

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/validate', (req, res) => {
    const { key, deviceId } = req.body;
    const record = keys.get(key);
    if (!record) return res.json({ valid: false, reason: 'invalid_key' });
    if (record.type === 'premium') return res.json({ valid: true, type: 'premium' });
    if (record.deviceId !== deviceId) return res.json({ valid: false, reason: 'wrong_device' });
    if (Date.now() > record.expiresAt) return res.json({ valid: false, reason: 'expired' });
    res.json({ valid: true, type: 'normal', expiresAt: record.expiresAt });
});

app.post('/generate-token', (req, res) => {
    const { deviceId } = req.body;
    const lastGen = cooldown.get(deviceId);
    if (lastGen && (Date.now() - lastGen) < (12 * 60 * 60 * 1000)) {
        return res.status(429).json({ error: 'Cooldown active. Wait 12 hours.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: deviceId,
        expiresAt: Date.now() + (60 * 60 * 1000)
    });
    res.json({ token: token });
});

app.post('/generate-key', (req, res) => {
    const { token } = req.body;
    const tokenData = oneTimeTokens.get(token);
    if (!tokenData || Date.now() > tokenData.expiresAt) {
        return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const lastGen = cooldown.get(tokenData.deviceId);
    if (lastGen && (Date.now() - lastGen) < (12 * 60 * 60 * 1000)) {
        return res.status(429).json({ error: 'Cooldown active. Wait 12 hours.' });
    }
    const newKey = createNormalKey(tokenData.deviceId);
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000);
    cooldown.set(tokenData.deviceId, Date.now());
    oneTimeTokens.delete(token);
    res.json({ key: newKey, expiresAt: expiresAt });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running'));
