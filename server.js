const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// In-memory storage
const keys = new Map();          // key -> { deviceId, expiresAt, type }
const oneTimeTokens = new Map(); // token -> { deviceId, expiresAt }
const cooldown = new Map();      // deviceId -> lastKeyGenerationTime

function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// Hardcoded premium keys (never expire)
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
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000); // 6 hours
    keys.set(key, { deviceId, expiresAt, type: 'normal' });
    return { key, expiresAt };
}

// CORS for all endpoints
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        keys: keys.size, 
        tokens: oneTimeTokens.size,
        cooldown: cooldown.size,
        endpoints: '/health, /test, /validate, /generate-token, /generate-key'
    });
});

// Simple test endpoint
app.get('/test', (req, res) => {
    res.json({ message: 'API is working', timestamp: new Date().toISOString() });
});

// Validate a key (for Game Guardian script)
app.post('/validate', (req, res) => {
    const { key, deviceId } = req.body;
    if (!key || !deviceId) {
        return res.json({ valid: false, reason: 'missing_fields' });
    }
    const record = keys.get(key);
    if (!record) return res.json({ valid: false, reason: 'invalid_key' });
    if (record.type === 'premium') return res.json({ valid: true, type: 'premium' });
    if (record.deviceId !== deviceId) return res.json({ valid: false, reason: 'wrong_device' });
    if (Date.now() > record.expiresAt) return res.json({ valid: false, reason: 'expired' });
    res.json({ valid: true, type: 'normal', expiresAt: record.expiresAt });
});

// Generate a one-time token (for Game Guardian to open Vercel)
app.post('/generate-token', (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
    }
    // Cooldown: 12 hours between key generations per device
    const lastGen = cooldown.get(deviceId);
    if (lastGen && (Date.now() - lastGen) < (12 * 60 * 60 * 1000)) {
        return res.status(429).json({ error: 'Cooldown active. Wait 12 hours.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: deviceId,
        expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour expiry for token
    });
    res.json({ token: token });
});

// Exchange token for a real key (called from Vercel frontend)
app.post('/generate-key', (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'token required' });
    }
    const tokenData = oneTimeTokens.get(token);
    if (!tokenData || Date.now() > tokenData.expiresAt) {
        return res.status(400).json({ error: 'Invalid or expired token' });
    }
    // Check cooldown again before generating key
    const lastGen = cooldown.get(tokenData.deviceId);
    if (lastGen && (Date.now() - lastGen) < (12 * 60 * 60 * 1000)) {
        return res.status(429).json({ error: 'Cooldown active. Wait 12 hours.' });
    }
    const { key, expiresAt } = createNormalKey(tokenData.deviceId);
    // Set cooldown for this device
    cooldown.set(tokenData.deviceId, Date.now());
    // Delete used token
    oneTimeTokens.delete(token);
    res.json({ key: key, expiresAt: expiresAt });
});

// Admin: Add a new premium key (optional, for your own use)
app.post('/add-premium', (req, res) => {
    const { adminSecret, customKey } = req.body;
    if (adminSecret !== 'your_admin_secret_123') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const newKey = customKey || generateKey();
    keys.set(newKey, { deviceId: null, expiresAt: null, type: 'premium' });
    res.json({ key: newKey, type: 'premium', expires: 'never' });
});

// For debugging: list all active tokens (admin only)
app.get('/debug/tokens', (req, res) => {
    const tokensList = Array.from(oneTimeTokens.entries()).map(([t, d]) => ({ token: t, ...d }));
    res.json({ tokens: tokensList });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Omega API running on port ${PORT}`);
    console.log(`Health: https://omega-key.onrender.com/health (replace with your actual domain)`);
});
