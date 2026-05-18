const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// ============ STORAGE ============
const keys = new Map();          // key -> { deviceId, expiresAt, type }
const oneTimeTokens = new Map(); // token -> { deviceId, expiresAt }

// ============ HELPERS ============
function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// ============ HARDCODED PREMIUM KEYS (NEVER EXPIRE) ============
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

// ============ CREATE NORMAL KEY (6 HOURS, DEVICE BOUND) ============
function createNormalKey(deviceId) {
    const key = generateKey();
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000); // 6 hours
    keys.set(key, { deviceId, expiresAt, type: 'normal' });
    return key;
}

// ============ ENDPOINT 1: VALIDATE KEY (CALLED FROM GG SCRIPT) ============
app.post('/validate', (req, res) => {
    const { key, deviceId } = req.body;
    
    if (!key || !deviceId) {
        return res.json({ valid: false, reason: 'missing_fields' });
    }
    
    const record = keys.get(key);
    
    if (!record) {
        return res.json({ valid: false, reason: 'invalid_key' });
    }
    
    // Premium key - never expires, any device
    if (record.type === 'premium') {
        return res.json({ valid: true, type: 'premium', expiresAt: null });
    }
    
    // Normal key - check device binding and expiry
    if (record.deviceId !== deviceId) {
        return res.json({ valid: false, reason: 'wrong_device' });
    }
    
    if (Date.now() > record.expiresAt) {
        return res.json({ valid: false, reason: 'expired', key: key });
    }
    
    // Key is valid
    res.json({ 
        valid: true, 
        type: 'normal', 
        expiresAt: record.expiresAt,
        hoursLeft: Math.floor((record.expiresAt - Date.now()) / (1000 * 60 * 60))
    });
});

// ============ ENDPOINT 2: RENEW EXPIRED KEY (CALLED FROM GG SCRIPT) ============
app.post('/renew', (req, res) => {
    const { deviceId, oldKey } = req.body;
    
    if (!deviceId || !oldKey) {
        return res.status(400).json({ error: 'Missing deviceId or oldKey' });
    }
    
    const oldRecord = keys.get(oldKey);
    
    if (!oldRecord || oldRecord.deviceId !== deviceId || oldRecord.type !== 'normal') {
        return res.status(403).json({ error: 'Invalid request' });
    }
    
    // Generate one-time token
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: deviceId,
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    });
    
    // Return link to Vercel frontend
    const newLink = `https://omega-destroyer.vercel.app/?token=${token}`;
    res.json({ link: newLink });
});

// ============ ENDPOINT 3: EXCHANGE TOKEN FOR NEW KEY (CALLED FROM VERCEL) ============
app.get('/key', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).send('No token provided');
    }
    
    const tokenData = oneTimeTokens.get(token);
    
    if (!tokenData || Date.now() > tokenData.expiresAt) {
        return res.status(400).send('Invalid or expired token');
    }
    
    // Create new normal key for this device
    const newKey = createNormalKey(tokenData.deviceId);
    const expiresAt = new Date(Date.now() + (6 * 60 * 60 * 1000)).toLocaleString();
    
    // Delete used token
    oneTimeTokens.delete(token);
    
    // Return HTML page with the key
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your New Key</title>
            <style>
                body {
                    background: linear-gradient(135deg, #0a0a0a, #1a1a2e);
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    background: rgba(20, 20, 40, 0.95);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 500px;
                    width: 100%;
                    text-align: center;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1);
                }
                h1 {
                    color: white;
                    margin-bottom: 10px;
                }
                .key {
                    font-family: monospace;
                    font-size: 20px;
                    background: #0a0a0a;
                    padding: 15px;
                    border-radius: 10px;
                    word-break: break-all;
                    color: #0f0;
                    border: 1px solid #0f0;
                    margin: 20px 0;
                }
                button {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 30px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 10px;
                }
                button:hover {
                    transform: scale(1.02);
                }
                .info {
                    color: #888;
                    font-size: 12px;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Your New Key</h1>
                <div class="key" id="key">${newKey}</div>
                <button onclick="copyKey()">Copy to Clipboard</button>
                <div class="info">Expires at: ${expiresAt}</div>
                <div class="info">Paste this key into Game Guardian to continue using the script.</div>
            </div>
            <script>
                function copyKey() {
                    const key = document.getElementById('key').innerText;
                    navigator.clipboard.writeText(key);
                    alert('Key copied!');
                }
            </script>
        </body>
        </html>
    `);
});

// ============ ENDPOINT 4: REQUEST NEW KEY TOKEN (FROM VERCEL FRONTEND) ============
app.post('/request-new-key-token', (req, res) => {
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId' });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    oneTimeTokens.set(token, {
        deviceId: deviceId,
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    });
    
    res.json({ token: token });
});

// ============ ENDPOINT 5: HEALTH CHECK ============
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running', 
        keysCount: keys.size,
        tokensCount: oneTimeTokens.size,
        premiumCount: PREMIUM_KEYS.length
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
    console.log(`Premium keys loaded: ${PREMIUM_KEYS.length}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
