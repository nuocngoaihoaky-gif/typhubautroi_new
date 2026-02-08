import { rtdb, verifyInitData } from './_lib';

const REGEN_RATE = 3;

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // 🔥 CHỈ ĐỌC RTDB (KHÔNG TỐN READ FIRESTORE)
        const snapshot = await walletRef.once('value');
        const data = snapshot.val() || {};

        // Tính toán năng lượng hồi offline
        const now = Date.now();
        const lastUpdate = data.last_energy_update || now;
        const maxEnergy = data.baseMaxEnergy || 1000;
        let currentEnergy = data.energy || 0;
        const elapsed = Math.floor((now - lastUpdate) / 1000);

        if (elapsed > 0 && currentEnergy < maxEnergy) {
            currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
        }

        return res.status(200).json({
            balance: data.balance || 0,
            diamond: data.diamond || 0,
            energy: currentEnergy,
            baseMaxEnergy: maxEnergy,
            server_time: now
        });

    } catch (e) {
        return res.status(500).json({ error: 'Sync failed' });
    }
}
