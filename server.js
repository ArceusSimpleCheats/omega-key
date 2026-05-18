const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const keys = new Map();
const oneTimeTokens = new Map();
const cooldown = new Map(); // deviceId -> lastKeyGenerationTime

function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// Hardcoded premium keys
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
    return key;
}

// Enable CORS
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
        cooldown: cooldown.size 
    });
});

// Validate key
app.post('/validate', (req, res) => {
    const { key, deviceId } = req.body;
    const record = keys.get(key);
    
    if (!record) return res.json({ valid: false, reason: 'invalid_key' });
    if (record.type === 'premium') return res.json({ valid: true, type: 'premium' });
    if (record.deviceId !== deviceId) return res.json({ valid: false, reason: 'wrong_device' });
    if (Date.now() > record.expiresAt) return res.json({ valid: false, reason: 'expired' });
    
    res.json({ valid: true, type: 'normal', expiresAt: record.expiresAt });
});

// Renew expired key (also respects 6 hour cooldown)
app.post('/renew', (req, res) => {
    const { deviceId, oldKey } = req.body;
    const oldRecord = keys.get(oldKey);
    
    if (!oldRecord || oldRecord.deviceId !== deviceId || oldRecord.type !== 'normal') {
        return res.status(403).json({ error: 'Invalid request' });
    }
    
    // Check 6 hour cooldown from last key generation
    const lastGen = cooldown.get(deviceId);
    if (lastGen && (Date.now() - lastGen) < (6 * 60 * 60 * 1000)) {
        const remainingHours = Math.ceil(((6 * 60 * 60 * 1000) - (Date.now() - lastGen)) / (60 * 60 * 1000));
        const remainingMinutes = Math.ceil(((6 * 60 * 60 * 1000) - (Date.now() - lastGen)) / (60 * 1000));
        return res.status(429).json({ 
            error: `Cooldown: You can only get one key every 6 hours. Wait ${remainingHours} hours.`,
            remainingHours: remainingHours,
            remainingMinutes: remainingMinutes
        });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: deviceId,
        expiresAt: Date.now() + (5 * 60 * 1000)
    });
    
    res.json({ link: `https://omega-destroyer.vercel.app/?token=${token}` });
});

// Request new key token (6 hour cooldown)
app.post('/request-new-key-token', (req, res) => {
    const { deviceId } = req.body;
    const id = deviceId || req.ip;
    
    // Check 6 hour cooldown (21600000 milliseconds)
    const lastGeneration = cooldown.get(id);
    if (lastGeneration && (Date.now() - lastGeneration) < (6 * 60 * 60 * 1000)) {
        const elapsed = Date.now() - lastGeneration;
        const remainingMs = (6 * 60 * 60 * 1000) - elapsed;
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
        const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        const remainingSeconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
        
        return res.status(429).json({ 
            error: `Cooldown: You can only generate one key every 6 hours. Wait ${remainingHours}h ${remainingMinutes}m ${remainingSeconds}s.`,
            remainingHours: remainingHours,
            remainingMinutes: remainingMinutes,
            remainingSeconds: remainingSeconds,
            cooldownMs: remainingMs
        });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: id,
        expiresAt: Date.now() + (5 * 60 * 1000)
    });
    
    res.json({ token: token });
});

// Exchange token for key - THIS SETS THE COOLDOWN
app.get('/key', (req, res) => {
    const { token } = req.query;
    const tokenData = oneTimeTokens.get(token);
    
    if (!tokenData || Date.now() > tokenData.expiresAt) {
        return res.status(400).send('Invalid or expired token');
    }
    
    const deviceId = tokenData.deviceId;
    
    // Final cooldown check before generating key
    const lastGen = cooldown.get(deviceId);
    if (lastGen && (Date.now() - lastGen) < (6 * 60 * 60 * 1000)) {
        const remainingHours = Math.ceil(((6 * 60 * 60 * 1000) - (Date.now() - lastGen)) / (60 * 60 * 1000));
        return res.status(429).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Cooldown</title>
                <style>
                    body {
                        background: linear-gradient(135deg, #0a0a0a, #1a1a2e);
                        font-family: Arial, sans-serif;
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        background: rgba(20,20,40,0.95);
                        border-radius: 20px;
                        padding: 40px;
                        max-width: 500px;
                        text-align: center;
                    }
                    h1 { color: #ff6600; }
                    .cooldown { font-size: 48px; color: #ff6600; margin: 20px 0; }
                    .info { color: #888; margin-top: 20px; }
                    button {
                        background: #667eea;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 30px;
                        margin-top: 20px;
                        cursor: pointer;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Cooldown Active</h1>
                    <div class="cooldown">⏳</div>
                    <p>You can only generate one key every 6 hours.</p>
                    <p>Please wait ${remainingHours} hours before requesting another key.</p>
                    <button onclick="location.href='https://omega-destroyer.vercel.app'">Back to Home</button>
                    <div class="info">Premium keys never expire and have no cooldown.</div>
                </div>
            </body>
            </html>
        `);
    }
    
    // Generate the key
    const newKey = createNormalKey(deviceId);
    const expiresAt = new Date(Date.now() + (6 * 60 * 60 * 1000)).toLocaleString();
    
    // SET COOLDOWN - 6 hours from now
    cooldown.set(deviceId, Date.now());
    
    // Clean old cooldown entries (keep last 1000)
    if (cooldown.size > 1000) {
        const oldest = [...cooldown.entries()].sort((a,b) => a[1] - b[1])[0];
        cooldown.delete(oldest[0]);
    }
    
    oneTimeTokens.delete(token);
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Key</title>
            <style>
                body {
                    background: linear-gradient(135deg, #0a0a0a, #1a1a2e);
                    font-family: Arial, sans-serif;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    background: rgba(20,20,40,0.95);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 500px;
                    text-align: center;
                }
                .key {
                    font-family: monospace;
                    font-size: 18px;
                    background: #0a0a0a;
                    padding: 15px;
                    border-radius: 10px;
                    color: #0f0;
                    border: 1px solid #0f0;
                    word-break: break-all;
                }
                button {
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 30px;
                    margin-top: 20px;
                    cursor: pointer;
                }
                .info { color: #888; font-size: 12px; margin-top: 20px; }
                .warning { color: #ff6600; font-size: 12px; margin-top: 15px; }
                h1 { color: white; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Your New Key</h1>
                <div class="key" id="key">${newKey}</div>
                <button onclick="copyKey()">Copy Key</button>
                <div class="info">Expires in 6 hours: ${expiresAt}</div>
                <div class="warning">⚠️ You cannot generate another key for 6 hours. Premium keys have no cooldown.</div>
            </div>
            <script>
                function copyKey() {
                    navigator.clipboard.writeText(document.getElementById('key').innerText);
                    alert('Key copied!');
                }
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
