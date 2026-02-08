import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import crypto from 'crypto';

// ============================================================
// 1. KẾT NỐI FIREBASE (Singleton - Chỉ chạy 1 lần)
// ============================================================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!getApps().length) {
    initializeApp({
        credential: cert(serviceAccount),
        // Trỏ đúng vào server Singapore
        databaseURL: "https://dvmxh-like-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

const app = getApp();
const db = getFirestore(app);   // Firestore (Lưu Profile, Lịch sử)
const rtdb = getDatabase(app);  // Realtime DB (Lưu Vàng, Energy)

// ============================================================
// 2. BẢO MẬT TELEGRAM (Verify InitData)
// ============================================================
function verifyInitData(initData, botToken) {
    if (!initData) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");

    // Sắp xếp và tạo chuỗi kiểm tra
    const dataCheckString = [...params.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

    // Tạo khóa bí mật từ Bot Token
    const secret = crypto
        .createHmac("sha256", "WebAppData")
        .update(botToken)
        .digest();

    // Tính toán hash để so sánh
    const calculatedHash = crypto
        .createHmac("sha256", secret)
        .update(dataCheckString)
        .digest("hex");

    // So sánh chữ ký
    if (calculatedHash !== hash) return null;

    // Kiểm tra hạn sử dụng (Chống Replay Attack)
    // Giới hạn phiên: 3 giờ (10800 giây)
    const authDate = parseInt(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);
    
    if (now - authDate > 10800) {
        console.error("InitData expired (Quá hạn 3h)");
        return null;
    }

    // Trả về thông tin user
    try {
        return JSON.parse(params.get("user"));
    } catch {
        return null;
    }
}

// Xuất khẩu để các file API khác sử dụng
export { db, rtdb, verifyInitData };
