import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import crypto from 'crypto';

// ============================================================
// 1. KẾT NỐI FIREBASE (MULTI-APP SETUP)
// ============================================================

// A. Cấu hình cho FIRESTORE (Lưu Giftcode, Profile) - Dùng App Mặc Định
const serviceAccountFirestore = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// B. Cấu hình cho REALTIME DB (Lưu Tiền, Energy) - Dùng App Phụ
const serviceAccountRTDB = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_RTDB);

let firestoreApp;
let rtdbApp;

// --- Khởi tạo App 1: FIRESTORE (Default App) ---
if (getApps().length === 0) {
    firestoreApp = initializeApp({
        credential: cert(serviceAccountFirestore)
        // Firestore không cần databaseURL, nó tự nhận theo project ID
    });
} else {
    firestoreApp = getApp(); // Lấy app mặc định
}

// --- Khởi tạo App 2: REALTIME DB (Named App) ---
const RTDB_APP_NAME = 'RTDB_WORKER'; // Đặt tên riêng để không bị trùng
const existingApps = getApps();
const foundRtdbApp = existingApps.find(app => app.name === RTDB_APP_NAME);

if (!foundRtdbApp) {
    rtdbApp = initializeApp({
        credential: cert(serviceAccountRTDB),
        // 🔥 URL này phải khớp với project chứa Realtime DB
        databaseURL: "https://typhubautroi-db-default-rtdb.asia-southeast1.firebasedatabase.app" 
    }, RTDB_APP_NAME);
} else {
    rtdbApp = getApp(RTDB_APP_NAME);
}

// Xuất ra 2 instance DB từ 2 App khác nhau
const db = getFirestore(firestoreApp);  // Kết nối Firestore của Project 1
const rtdb = getDatabase(rtdbApp);      // Kết nối RTDB của Project 2

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
