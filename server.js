require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcrypt");

mongoose.set("debug", true); // デバッグログは引き続き有効にしておきましょう

// モデルのインポート
const Question = require("./models/Question");
const User = require("./models/User");
const Answer = require("./models/Answer");
const Operator = require("./models/Operator");
const SuperAdmin = require("./models/SuperAdmin");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
// --- ミドルウェア ---

app.use(express.json());

// CORS設定（開発環境用）
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// セッション設定
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // HTTPSの場合はtrueに変更
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24時間
      sameSite: "lax", // セッションクッキーの設定を追加
    },
  })
);

app.use(express.static("public"));

// --- データベース接続 ---

console.log("MONGODB_URI exists?", !!process.env.MONGODB_URI);
if (process.env.MONGODB_URI) {
  console.log(
    "MONGODB_URI head:",
    process.env.MONGODB_URI.replace(/\/\/.*?:.*?@/, "//****:****@").slice(
      0,
      120
    )
  );
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("❌ MONGODB_URI is not set");
}

mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    family: 4,
  })
  .then(() => {
    console.log("✅ MongoDBに接続しました");
    // デフォルトルームの問題をロード（後方互換性のため）
    loadQuestions("default");
  })
  .catch((err) => console.error("❌ MongoDB接続エラー:", err));

// --- ダミーの問題データと初期化関数 (変更なし) ---
const dummyQuestions = [
  {
    text: "世界で一番高い山は？",
    options: [
      { id: "A", text: "K2" },
      { id: "B", text: "エベレスト" },
      { id: "C", text: "マッターホルン" },
      { id: "D", text: "富士山" },
    ],
    correctOptionId: "B",
  },
  {
    text: "日本の首都は？",
    options: [
      { id: "A", text: "大阪" },
      { id: "B", text: "京都" },
      { id: "C", text: "東京" },
      { id: "D", text: "札幌" },
    ],
    correctOptionId: "C",
  },
  // さらに問題を追加できます
];

async function initializeQuizData(roomId = "default") {
  try {
    const count = await Question.countDocuments({ roomId });
    if (count === 0) {
      const questionsWithRoomId = dummyQuestions.map(q => ({ ...q, roomId }));
      await Question.insertMany(questionsWithRoomId);
      console.log(`[${roomId}] ダミーの問題データをデータベースに投入しました。`);
    } else {
      console.log(`[${roomId}] 問題データは既に存在します。スキップしました。`);
    }
  } catch (error) {
    console.error(`[${roomId}] 問題データの初期化中にエラーが発生しました:`, error);
  }
}

const path = require("path");
const multer = require("multer");

const uploadDir = path.join(__dirname, "public", "uploadsImage");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  },
});

const upload = multer({ storage });

const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const uploadMemory = multer({
  storage: multer.memoryStorage(),
});

function uploadBufferToCloudinary(buffer, roomId, resourceType = "image") {
  return new Promise((resolve, reject) => {
    // 運用者ごとにフォルダを分離
    const folder = roomId 
      ? (resourceType === "video" ? `quiz_videos/${roomId}` : `quiz_images/${roomId}`)
      : (resourceType === "video" ? "quiz_videos" : "quiz_images");
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

app.post(
  "/api/upload-image",
  requireOperator, // 運用者認証が必要
  uploadMemory.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "画像がありません" });
      }

      const roomId = req.roomId; // requireOperatorミドルウェアで自動設定される
      if (!roomId) {
        return res.status(400).json({ message: "ルームIDが取得できません" });
      }

      console.log(`[${roomId}] 画像をアップロード中...`);
      const result = await uploadBufferToCloudinary(req.file.buffer, roomId, "image");
      console.log(`[${roomId}] 画像アップロード成功: ${result.secure_url}`);
      res.json({ url: result.secure_url }); // ← MongoDBに保存するURL
    } catch (err) {
      console.error("画像アップロードエラー:", err);
      res.status(500).json({ message: "画像アップロード失敗" });
    }
  }
);

// 動画アップロードエンドポイント
app.post(
  "/api/upload-video",
  requireOperator, // 運用者認証が必要
  uploadMemory.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "動画がありません" });
      }

      const roomId = req.roomId; // requireOperatorミドルウェアで自動設定される
      if (!roomId) {
        return res.status(400).json({ message: "ルームIDが取得できません" });
      }

      console.log(`[${roomId}] 動画をアップロード中...`);
      const result = await uploadBufferToCloudinary(req.file.buffer, roomId, "video");
      console.log(`[${roomId}] 動画アップロード成功: ${result.secure_url}`);
      res.json({ url: result.secure_url }); // ← MongoDBに保存するURL
    } catch (err) {
      console.error("動画アップロードエラー:", err);
      res.status(500).json({ message: "動画アップロード失敗" });
    }
  }
);

// タイトル画面（左下）の画像アップロードエンドポイント
app.post(
  "/api/upload-title-image",
  requireOperator, // 運用者認証が必要
  uploadMemory.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "画像がありません" });
      }

      const roomId = req.roomId; // requireOperatorミドルウェアで自動設定される
      if (!roomId) {
        return res.status(400).json({ message: "ルームIDが取得できません" });
      }

      console.log(`[${roomId}] タイトル画像をアップロード中...`);
      const result = await uploadBufferToCloudinary(req.file.buffer, roomId, "image");
      console.log(`[${roomId}] タイトル画像アップロード成功: ${result.secure_url}`);

      // OperatorのtitleImageUrlを更新
      const operator = await Operator.findOne({ roomId });
      if (operator) {
        operator.titleImageUrl = result.secure_url;
        await operator.save();
        console.log(`[${roomId}] タイトル画像URLを保存しました`);
      }

      res.json({ url: result.secure_url });
    } catch (err) {
      console.error("タイトル画像アップロードエラー:", err);
      res.status(500).json({ message: "タイトル画像アップロード失敗" });
    }
  }
);

// タイトル画面（左下）の画像削除エンドポイント
app.delete("/api/operator/title-image", requireOperator, async (req, res) => {
  try {
    const roomId = req.roomId;
    const operator = await Operator.findOne({ roomId });

    if (operator) {
      operator.titleImageUrl = null;
      await operator.save();
      console.log(`[${roomId}] タイトル画像を削除しました`);
      res.json({ message: "タイトル画像を削除しました" });
    } else {
      res.status(404).json({ message: "運用者が見つかりません" });
    }
  } catch (err) {
    console.error("タイトル画像削除エラー:", err);
    res.status(500).json({ message: "タイトル画像削除失敗" });
  }
});

// --- ゲームの状態管理（ルーム単位） ---
class RoomState {
  constructor(roomId) {
    this.roomId = roomId;
    this.currentQuestionIndex = -1;
    this.questions = [];
    this.isQuizActive = false;
    this.quizTimer = null;
    this.QUESTION_DURATION = 10; // タイマー時間（秒）- 管理画面から変更可能
    this.currentRemainingTime = this.QUESTION_DURATION;
    this.currentQuestionData = null;
    this.currentQuestionStartTime = null; // 現在の問題の開始時刻
    this.currentQuestionResults = {
  questionId: null,
  totalVotes: 0,
  optionVotes: {},
  correctOptionId: null,
  answeredUserIds: new Set(),
};
    this.isShowingResults = false;
    this.answersOpen = false; // 回答受付中か（タイマー手動開始まで false）
    this.socketAnsweredFlags = new Map(); // Map<socket.id, boolean>
  }

  resetGameState() {
    this.currentQuestionIndex = -1;
    this.isQuizActive = false;
    if (this.quizTimer) {
      clearInterval(this.quizTimer);
      this.quizTimer = null;
  }
    this.currentRemainingTime = this.QUESTION_DURATION;
    this.currentQuestionData = null;
    this.currentQuestionStartTime = null;
    this.currentQuestionResults = {
    questionId: null,
    totalVotes: 0,
    optionVotes: {},
    correctOptionId: null,
    answeredUserIds: new Set(),
  };
    this.isShowingResults = false;
    this.answersOpen = false;
    this.socketAnsweredFlags.clear();
    console.log(`[${this.roomId}] ゲームの状態がリセットされました。`);
  }
}

// ルームごとの状態を管理するMap
const roomStates = new Map(); // Map<roomId, RoomState>

// ルーム状態を取得または作成
function getRoomState(roomId) {
  if (!roomId) {
    roomId = "default"; // デフォルトルーム（後方互換性のため）
  }
  if (!roomStates.has(roomId)) {
    roomStates.set(roomId, new RoomState(roomId));
    console.log(`[${roomId}] 新しいルーム状態を作成しました。`);
}
  return roomStates.get(roomId);
}

// 後方互換性のため、デフォルトルームの状態を初期化
getRoomState("default");

// サーバー起動時に問題をロード（ルーム対応）
async function loadQuestions(roomId = "default") {
  const roomState = getRoomState(roomId);
  roomState.questions = await Question.find({ roomId });
  if (roomState.questions.length === 0) {
    console.warn(`[${roomId}] データベースに問題がありません。`);
  } else {
    console.log(`[${roomId}] ${roomState.questions.length} 問の問題をロードしました。`);
  }
  io.to(roomId).emit("questionsUpdated"); // 該当ルームの主催者画面に更新を通知
  broadcastQuizStatus(roomId); // クイズステータス更新
}

// リアルタイム投票結果をブロードキャストする関数（ルーム対応）
function broadcastQuestionResults(roomId) {
  const roomState = getRoomState(roomId);
  console.log(`[${roomId}] broadcastQuestionResultsが呼び出されました。`);
  if (!roomState.currentQuestionResults.questionId) return;

  // showQuestionResults イベントは、結果表示が必要な時のみ送る
  io.to(roomId).emit("showQuestionResults", {
    questionId: roomState.currentQuestionResults.questionId,
    totalVotes: roomState.currentQuestionResults.totalVotes,
    optionVotes: roomState.currentQuestionResults.optionVotes,
    correctOptionId: roomState.currentQuestionResults.correctOptionId,
  });
  console.log(`[${roomId}] showQuestionResultsイベントをクライアントに送信しました。`);
}

// 各問題のタイマーを開始する関数（ルーム対応）
function startQuestionTimer(roomId) {
  const roomState = getRoomState(roomId);
  if (roomState.quizTimer) clearInterval(roomState.quizTimer);

  // タイマー（＝回答受付）開始
  roomState.answersOpen = true;

  // 動画があるかどうかをチェック
  const hasVideo = roomState.currentQuestionData?.options?.some(
    (opt) => opt.videoUrl && opt.videoUrl.trim() !== ""
  );
  
  if (hasVideo) {
    console.log(`[${roomId}] 動画があるため、タイマーを開始しません`);
    roomState.currentRemainingTime = roomState.QUESTION_DURATION;
    roomState.currentQuestionStartTime = Date.now();
    roomState.isShowingResults = false;
    // タイマーを開始せず、カウントダウンも送信しない
    broadcastQuizStatus(roomId);
    return;
  }

  roomState.currentRemainingTime = roomState.QUESTION_DURATION;
  roomState.currentQuestionStartTime = Date.now(); // 問題開始時刻を記録
  roomState.isShowingResults = false; // 新しい問題が始まったら結果表示中ではない
  io.to(roomId).emit("countdown", roomState.currentRemainingTime);
  broadcastQuizStatus(roomId);

  roomState.quizTimer = setInterval(() => {
    roomState.currentRemainingTime--;
    io.to(roomId).emit("countdown", roomState.currentRemainingTime);
    broadcastQuizStatus(roomId);

    if (roomState.currentRemainingTime <= 0) {
      clearInterval(roomState.quizTimer);
      roomState.currentRemainingTime = 0;
      console.log(`[${roomId}] 問題時間切れ！`);

      roomState.isShowingResults = false;
      roomState.answersOpen = false; // 時間切れで回答受付を締め切る
      broadcastQuizStatus(roomId); // ステータスを更新
    }
  }, 1000);
}

// --- 認証ミドルウェア ---
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.isSuperAdmin) {
    return next();
  }
  res.status(401).json({ message: "スーパー管理者権限が必要です" });
}

function requireOperator(req, res, next) {
  if (req.session && req.session.operatorId) {
    req.roomId = req.session.roomId; // ルームIDを自動設定
    return next();
  }
  res.status(401).json({ message: "運用者ログインが必要です" });
}

// --- 認証API ---
// 運用者ログイン
app.post("/api/auth/operator/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "ユーザー名とパスワードが必要です" });
    }

    const operator = await Operator.findOne({ username, isActive: true });
    if (!operator) {
      return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
    }

    const passwordMatch = await bcrypt.compare(password, operator.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
    }

    req.session.operatorId = operator._id.toString();
    req.session.roomId = operator.roomId;
    req.session.username = operator.username;

    res.json({
      success: true,
      roomId: operator.roomId,
      username: operator.username,
    });
  } catch (error) {
    console.error("ログインエラー:", error);
    res.status(500).json({ message: "ログイン処理中にエラーが発生しました" });
  }
});

// 運用者ログアウト
app.post("/api/auth/operator/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "ログアウト処理中にエラーが発生しました" });
    }
    res.json({ success: true });
  });
});

// 運用者ログイン状態確認
app.get("/api/auth/operator/status", async (req, res) => {
  if (req.session && req.session.operatorId) {
    // Operator情報を取得してタイトル画像のURLを含める
    const operator = await Operator.findById(req.session.operatorId);
    res.json({
      isLoggedIn: true,
      roomId: req.session.roomId,
      username: req.session.username,
      titleImageUrl: operator?.titleImageUrl || null,
    });
  } else {
    res.json({ isLoggedIn: false });
  }
});

// スーパー管理者ログイン
app.post("/api/auth/super-admin/login", async (req, res) => {
  try {
    console.log("[LOGIN] ログインリクエスト受信:", {
      username: req.body.username,
      hasPassword: !!req.body.password,
      sessionId: req.sessionID,
    });

    const { username, password } = req.body;
    if (!username || !password) {
      console.log("[LOGIN] ユーザー名またはパスワードが不足");
      return res.status(400).json({ message: "ユーザー名とパスワードが必要です" });
    }

    const superAdmin = await SuperAdmin.findOne({ username });
    if (!superAdmin) {
      console.log(`[LOGIN] スーパー管理者 "${username}" が見つかりません`);
      return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
    }

    console.log(`[LOGIN] スーパー管理者 "${username}" が見つかりました`);

    const passwordMatch = await bcrypt.compare(password, superAdmin.password);
    if (!passwordMatch) {
      console.log(`[LOGIN] パスワードが一致しません`);
      return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
    }

    console.log(`[LOGIN] パスワードが一致しました`);

    req.session.isSuperAdmin = true;
    req.session.superAdminId = superAdmin._id.toString();
    req.session.username = superAdmin.username;

    console.log(`[LOGIN] セッションに保存:`, {
      isSuperAdmin: req.session.isSuperAdmin,
      superAdminId: req.session.superAdminId,
      username: req.session.username,
      sessionId: req.sessionID,
    });

    // 最終ログイン時刻を更新
    await SuperAdmin.findByIdAndUpdate(superAdmin._id, {
      lastLoginAt: new Date(),
    });

    console.log(`[LOGIN] ログイン成功: ${username}`);
    res.json({ success: true, username: superAdmin.username });
  } catch (error) {
    console.error("[LOGIN] スーパー管理者ログインエラー:", error);
    res.status(500).json({ message: "ログイン処理中にエラーが発生しました" });
  }
});

// スーパー管理者ログアウト
app.post("/api/auth/super-admin/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "ログアウト処理中にエラーが発生しました" });
    }
    res.json({ success: true });
  });
});

// スーパー管理者ログイン状態確認
app.get("/api/auth/super-admin/status", (req, res) => {
  if (req.session && req.session.isSuperAdmin) {
    res.json({
      isLoggedIn: true,
      username: req.session.username,
    });
  } else {
    res.json({ isLoggedIn: false });
  }
});

// --- スーパー管理者用API（運用者管理） ---
// 運用者一覧取得
app.get("/api/super-admin/operators", requireSuperAdmin, async (req, res) => {
  try {
    const operators = await Operator.find({}).select("-password");
    res.json(operators);
  } catch (error) {
    console.error("運用者一覧取得エラー:", error);
    res.status(500).json({ message: "運用者一覧の取得に失敗しました" });
  }
});

// 運用者作成
app.post("/api/super-admin/operators", requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "ユーザー名とパスワードが必要です" });
    }

    // ルームIDを自動生成
    const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // パスワードをハッシュ化
    const hashedPassword = await bcrypt.hash(password, 10);

    const operator = new Operator({
      username,
      password: hashedPassword,
      email: email || "",
      roomId,
    });

    await operator.save();

    // パスワードを除いて返す
    const operatorData = operator.toObject();
    delete operatorData.password;
    res.status(201).json(operatorData);
  } catch (error) {
    if (error.code === 11000) {
      // 重複エラー
      return res.status(400).json({ message: "このユーザー名は既に使用されています" });
    }
    console.error("運用者作成エラー:", error);
    res.status(500).json({ message: "運用者の作成に失敗しました" });
  }
});

// 運用者削除
app.delete("/api/super-admin/operators/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const operator = await Operator.findByIdAndDelete(id);
    if (!operator) {
      return res.status(404).json({ message: "運用者が見つかりませんでした" });
    }
    res.json({ message: "運用者を削除しました" });
  } catch (error) {
    console.error("運用者削除エラー:", error);
    res.status(500).json({ message: "運用者の削除に失敗しました" });
  }
});

// 運用者情報更新
app.put("/api/super-admin/operators/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, isActive, password } = req.body;

    const updateData = {};
    if (username) updateData.username = username;
    if (email !== undefined) updateData.email = email;
    if (isActive !== undefined) updateData.isActive = isActive;
    // パスワードが提供されている場合のみ更新
    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    const operator = await Operator.findByIdAndUpdate(id, updateData, { new: true }).select(
      "-password"
    );
    if (!operator) {
      return res.status(404).json({ message: "運用者が見つかりませんでした" });
    }
    res.json(operator);
  } catch (error) {
    console.error("運用者更新エラー:", error);
    res.status(500).json({ message: "運用者の更新に失敗しました" });
  }
});

// 運用者パスワード変更
app.put("/api/super-admin/operators/:id/password", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: "パスワードが必要です" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const operator = await Operator.findByIdAndUpdate(id, { password: hashedPassword });
    if (!operator) {
      return res.status(404).json({ message: "運用者が見つかりませんでした" });
    }
    res.json({ message: "パスワードを変更しました" });
  } catch (error) {
    console.error("パスワード変更エラー:", error);
    res.status(500).json({ message: "パスワードの変更に失敗しました" });
  }
});

// 全ルームの統計情報取得
app.get("/api/super-admin/stats", requireSuperAdmin, async (req, res) => {
  try {
    const operators = await Operator.find({ isActive: true });
    const stats = await Promise.all(
      operators.map(async (operator) => {
        const questionCount = await Question.countDocuments({ roomId: operator.roomId });
        // ニックネームを入力したユーザー（匿名参加者以外）をカウント
        const userCount = await User.countDocuments({ 
          roomId: operator.roomId,
          nickname: { $ne: "匿名参加者" }
        });
        const answerCount = await Answer.countDocuments({ roomId: operator.roomId });
        return {
          roomId: operator.roomId,
          operatorName: operator.username,
          questionCount,
          userCount,
          answerCount,
        };
      })
    );
    res.json(stats);
  } catch (error) {
    console.error("統計情報取得エラー:", error);
    res.status(500).json({ message: "統計情報の取得に失敗しました" });
  }
});

// スーパー管理者ログイン画面
app.get("/super-admin-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "super-admin-login.html"));
});

app.get("/super-admin-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "super-admin-login.html"));
});

// スーパー管理者管理画面（認証が必要）
app.get("/super-admin", requireSuperAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "super-admin.html"));
});

app.get("/super-admin.html", requireSuperAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "super-admin.html"));
});

// 運用者ログイン画面
app.get("/operator-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-login.html"));
});

app.get("/operator-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-login.html"));
});

// 運用者管理画面（認証が必要）
app.get("/operator-admin", requireOperator, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-admin.html"));
});

app.get("/operator-admin.html", requireOperator, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-admin.html"));
});

// 運用者表示画面（認証が必要）
app.get("/operator-display", requireOperator, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-display.html"));
});

app.get("/operator-display.html", requireOperator, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "operator-display.html"));
});

// --- APIエンドポイント (主催者用 CRUD操作) ---
// --- 運用者用API（ルーム対応） ---
app.get("/api/questions", requireOperator, async (req, res) => {
  try {
    const roomId = req.roomId;
    const allQuestions = await Question.find({ roomId });
    res.json(allQuestions);
  } catch (error) {
    res.status(500).json({ message: "問題の取得に失敗しました。" });
  }
});

app.post("/api/questions", requireOperator, async (req, res) => {
  const roomId = req.roomId;
  const q = new Question({ ...req.body, roomId });
  await q.save();
  await loadQuestions(roomId);
  io.to(roomId).emit("questionsUpdated");
  res.status(201).json(q);
});

app.delete("/api/questions/:id", requireOperator, async (req, res) => {
  try {
    const { id } = req.params;
    const roomId = req.roomId;
    const result = await Question.findOneAndDelete({ _id: id, roomId: roomId });
    if (!result) {
      return res.status(404).json({ message: "問題が見つかりませんでした。" });
    }
    console.log(`[${roomId}] 問題を削除しました:`, id);
    await loadQuestions(roomId);
    io.to(roomId).emit("questionsUpdated");
    res.status(200).json({ message: "問題を削除しました。" });
  } catch (error) {
    console.error("問題の削除エラー:", error);
    res.status(500).json({ message: "問題の削除に失敗しました。" });
  }
});

app.put("/api/questions/:id", requireOperator, async (req, res) => {
  const roomId = req.roomId;
  const q = await Question.findOneAndUpdate(
    { _id: req.params.id, roomId: roomId },
    req.body,
    { new: true }
  );
  if (!q) {
    return res.status(404).json({ message: "問題が見つかりませんでした。" });
  }
  await loadQuestions(roomId);
  io.to(roomId).emit("questionsUpdated");
  res.json(q);
});

// --- タイマー設定API（ルーム対応） ---
app.get("/api/timer-duration", requireOperator, (req, res) => {
  const roomId = req.roomId;
  const roomState = getRoomState(roomId);
  res.json({ duration: roomState.QUESTION_DURATION });
});

app.put("/api/timer-duration", requireOperator, (req, res) => {
  const { duration } = req.body;
  const newDuration = parseInt(duration, 10);
  const roomId = req.roomId;
  const roomState = getRoomState(roomId);
  
  if (isNaN(newDuration) || newDuration < 1 || newDuration > 300) {
    return res.status(400).json({ 
      message: "タイマー時間は1秒以上300秒以下である必要があります。" 
    });
  }
  
  roomState.QUESTION_DURATION = newDuration;
  console.log(`[${roomId}] タイマー時間を ${roomState.QUESTION_DURATION} 秒に変更しました。`);
  
  // クイズが進行中でない場合のみ、現在の残り時間も更新
  if (!roomState.isQuizActive) {
    roomState.currentRemainingTime = roomState.QUESTION_DURATION;
  }
  
  broadcastQuizStatus(roomId); // ステータスを更新
  res.json({ duration: roomState.QUESTION_DURATION });
});

// --- ヘルパー関数: スコア更新処理をまとめる（ルーム対応） ---
async function updateScoresForCurrentQuestion(roomId) {
  const roomState = getRoomState(roomId);
  if (!roomState.currentQuestionData || !roomState.currentQuestionData._id) {
    console.warn(
      `[${roomId}] [updateScores] スコア更新スキップ: 現在の問題データが無効です。`
    );
    return;
  }
  const prevQuestionId = roomState.currentQuestionData._id;
  console.log(`[${roomId}] [updateScores] スコア更新処理開始: 問題ID ${prevQuestionId}`);

  console.log(
    `[${roomId}] [updateScores] 回答済みユーザーIDs: ${Array.from(
      roomState.currentQuestionResults.answeredUserIds
    ).join(", ")}`
  );

  for (const userId of roomState.currentQuestionResults.answeredUserIds) {
    let objectUserId;
    try {
      objectUserId = new mongoose.Types.ObjectId(userId);
    } catch (e) {
      console.error(
        `[${roomId}] [updateScores] 無効なUserID形式を検出しました: ${userId}. エラー: ${e.message}`
      );
      continue;
    }

    console.log(`[${roomId}] [updateScores] ユーザー ${userId} の回答をチェック中...`);

    try {
      const latestAnswer = await Answer.findOne({
        userId: objectUserId,
        questionId: prevQuestionId,
        isCorrect: true,
        roomId: roomId,
      }).sort({ timestamp: -1 });

      if (latestAnswer) {
        console.log(
          `[${roomId}] [updateScores] ユーザー ${userId} の正解回答が見つかりました。`
        );

        const user = await User.findOne({ _id: objectUserId, roomId: roomId });
        if (
          user &&
          user.scoreHistory &&
          user.scoreHistory.includes(prevQuestionId.toString())
        ) {
          console.log(
            `[${roomId}] [updateScores] ユーザー ${userId} はこの問題のスコアを既に更新済みです。スキップ。`
          );
          continue;
        }

        const updatedUser = await User.findOneAndUpdate(
          { _id: objectUserId, roomId: roomId },
          {
            $inc: { score: 1 },
            $push: { scoreHistory: prevQuestionId.toString() },
          },
          { new: true }
        );
        if (updatedUser) {
        console.log(
            `[${roomId}] [updateScores] ユーザー ${userId} のスコアを更新しました。新しいスコア: ${updatedUser.score}`
        );
        }
      } else {
        console.log(
          `[${roomId}] [updateScores] ユーザー ${userId} は前の問題 (${prevQuestionId}) に正解していません。または回答が見つかりません。`
        );
      }
    } catch (error) {
      console.error(
        `[${roomId}] [updateScores] ユーザー ${userId} の回答検索またはスコア更新中に予期せぬエラー:`,
        error
      );
    }
  }
  console.log(`[${roomId}] [updateScores] スコア更新処理完了。`);
}

//最終ランキングを取得する関数（ルーム対応）
async function getFinalRanking(roomId) {
  try {
    // ニックネームが設定されているユーザーを取得（ルームIDでフィルタ）
    const users = await User.find({ 
      nickname: { $ne: "匿名参加者" },
      roomId: roomId
    });
    
    // 各ユーザーの正解した問題の合計回答時間を計算
    const usersWithTotalTime = await Promise.all(
      users.map(async (user) => {
        // 正解した回答の回答時間の合計を取得（ルームIDでフィルタ）
        const correctAnswers = await Answer.find({
          userId: user._id,
          isCorrect: true,
          roomId: roomId,
        });
        
        const totalAnswerTime = correctAnswers.reduce((sum, answer) => {
          return sum + (answer.answerTime || 0);
        }, 0);
        
        return {
          user: user,
          totalAnswerTime: totalAnswerTime,
        };
      })
    );
    
    // スコア降順、同じスコアの場合は回答時間の合計が小さい順（早押し優先）でソート
    usersWithTotalTime.sort((a, b) => {
      if (a.user.score !== b.user.score) {
        return b.user.score - a.user.score; // スコア降順
      }
      return a.totalAnswerTime - b.totalAnswerTime; // 回答時間昇順（短い方が上位）
    });
    
    // 上位5名を取得
    const topUsers = usersWithTotalTime.slice(0, 5);
    
    // ニックネーム、スコア、合計回答時間を返す
    return topUsers.map((item) => ({
      nickname: item.user.nickname,
      score: item.user.score,
      totalAnswerTime: item.totalAnswerTime,
    }));
  } catch (error) {
    console.error(`[${roomId}] 最終ランキングの取得エラー:`, error);
    return [];
  }
}

// --- ヘルパー関数: 単一ソケットに quizStatus を送信（ルーム対応） ---
function sendQuizStatusToSocket(s) {
  const roomId = s.roomId || "default";
  const roomState = getRoomState(roomId);
  
  let qText = "なし";
  let qOptions = [];
  if (roomState.isQuizActive && roomState.currentQuestionData) {
    qText = roomState.currentQuestionData.text;
    qOptions = roomState.currentQuestionData.options;
  }
  
  // 同じルームの参加者数をカウント
  const participantCount = Array.from(io.sockets.sockets.values()).filter(
    (cl) => cl.roomId === roomId && !cl.isAdmin && !cl.isController
  ).length;

  s.emit("quizStatus", {
    isActive: roomState.isQuizActive,
    currentQuestionIndex: roomState.currentQuestionIndex,
    currentQuestionText: qText,
    currentQuestionOptions: qOptions,
    totalQuestions: roomState.questions.length,
    remainingTime: roomState.currentRemainingTime,
    timerDuration: roomState.QUESTION_DURATION,
    connectedUsers: participantCount,
    isShowingResults: roomState.isShowingResults,
    isController: s.isController,
    isAdmin: s.isAdmin,
    roomId: roomId,
  });
  console.log(
    `[${roomId}] [sendQuizStatusToSocket] ソケット ${s.id} に quizStatus を送信。isController: ${s.isController}, isAdmin: ${s.isAdmin}`
  );
}

// --- ヘルパー関数: 指定ルームの全クライアントに quizStatus をブロードキャスト（ルーム対応） ---
function broadcastQuizStatus(roomId) {
  if (!roomId) {
    // roomIdが指定されていない場合は、すべてのルームに送信（後方互換性）
  io.sockets.sockets.forEach((s) => sendQuizStatusToSocket(s));
  } else {
    // 指定されたルームのクライアントにのみ送信
    // Socket.IOのルーム機能を使用して、ルーム内のソケットを取得
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room) {
      room.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.roomId === roomId) {
          sendQuizStatusToSocket(socket);
        }
      });
    }
  }
}

// --- Socket.IO接続イベント（ルーム対応） ---
io.on("connection", async (socket) => {
  socket.isAdmin = false;
  socket.isController = false;

  // ルームIDを取得（クエリパラメータまたはauthから）
  const roomId = socket.handshake.query?.roomId || 
                 socket.handshake.auth?.roomId || 
                 "default";
  socket.roomId = roomId;
  socket.join(roomId); // Socket.IOのルーム機能を使用
  console.log(`[${roomId}] ソケット ${socket.id} が接続しました。`);

  // 運用者認証（管理画面用）
  socket.on("adminConnect", async () => {
    // セッション情報はSocket.IOから直接取得できないため、
    // 運用者は既にログイン済みで、roomIdが一致することを前提とする
    // 実際の認証はHTTPリクエストレベルで行われる
    socket.isAdmin = true;
    socket.join("admins");
    console.log(`[${roomId}] Admin connected`, socket.id);
    broadcastQuizStatus(roomId);
  });

  // 運用者認証（表示画面用）
  socket.on("controllerConnect", async () => {
    // セッション情報はSocket.IOから直接取得できないため、
    // 運用者は既にログイン済みで、roomIdが一致することを前提とする
    // 実際の認証はHTTPリクエストレベルで行われる
    socket.isController = true;
    console.log(`[${roomId}] Controller connected`, socket.id);
    // 問題をロードしてからステータスを送信
    await loadQuestions(roomId);
    broadcastQuizStatus(roomId);
  });

  socket.on("disconnect", async () => {
    const roomId = socket.roomId || "default";
    console.log(`[${roomId}] クライアントが切断しました:`, socket.id);
    const roomState = getRoomState(roomId);
    roomState.socketAnsweredFlags.delete(socket.id);
    broadcastQuizStatus(roomId);
  });

  socket.on("answer", async (data) => {
    const roomId = socket.roomId || "default";
    const roomState = getRoomState(roomId);
    
    if (
      !roomState.isQuizActive ||
      !roomState.answersOpen ||
      roomState.currentRemainingTime <= 0 ||
      !roomState.currentQuestionData ||
      roomState.currentQuestionData._id.toString() !== data.questionId ||
      roomState.socketAnsweredFlags.get(socket.id)
    ) {
      socket.emit("answerFeedback", {
        isCorrect: false,
        message: "現在、回答を受け付けていません。または既にも回答済みです。",
      });
      return;
    }

    console.log(`[${roomId}] 参加者 ${socket.id} (User: ${socket.userId}) が回答:`, data);

    const currentQ = roomState.questions.find(
      (q) => q._id.toString() === data.questionId
    );
    if (!currentQ) {
      socket.emit("answerFeedback", {
        isCorrect: false,
        message: "問題が見つかりません。",
      });
      console.error(`[${roomId}] 回答エラー: 現在の問題が見つかりません。`);
      return;
    }

    const isCorrect = currentQ.correctOptionId === data.selectedOptionId;
    console.log(`[${roomId}] 回答は ${isCorrect ? "正解" : "不正解"} でした。`);

    // 問題開始からの経過時間を計算（秒）
    const answerTime = roomState.currentQuestionStartTime 
      ? Math.round((Date.now() - roomState.currentQuestionStartTime) / 1000)
      : null;

    const newAnswer = new Answer({
      userId: socket.userId,
      questionId: currentQ._id,
      selectedOptionId: data.selectedOptionId,
      isCorrect: isCorrect,
      answerTime: answerTime,
      roomId: roomId, // ルームIDを追加
    });
    try {
      await newAnswer.save();
      console.log(`[${roomId}] 回答データが正常に保存されました:`, newAnswer);
    } catch (error) {
      console.error(`[${roomId}] 回答データの保存中にエラーが発生しました:`, error);
    }

    roomState.currentQuestionResults.totalVotes++;
    roomState.currentQuestionResults.optionVotes[data.selectedOptionId] =
      (roomState.currentQuestionResults.optionVotes[data.selectedOptionId] || 0) + 1;
    roomState.currentQuestionResults.answeredUserIds.add(socket.userId.toString());

    roomState.socketAnsweredFlags.set(socket.id, true);
    socket.emit("answerFeedback", {
      isCorrect: isCorrect,
      message: "回答を送信しました。",
    });
  });

  socket.on("hostCommand", async (commandData) => {
    const roomId = socket.roomId || "default";
    const roomState = getRoomState(roomId);
    
    try {
      if (commandData.type === "resetNicknames") {
        // resetNicknames コマンドの場合
        if (!socket.isAdmin) {
          console.warn(
            `[${roomId}] 非管理者ソケットからのニックネームリセットコマンドをブロックしました:`,
            socket.id
          );
          socket.emit(
            "message",
            "ニックネームのリセットは管理者のみ実行できます。"
          );
          return;
        }
        console.log(`[${roomId}] 管理者コマンドを受信:`, commandData.type);
        try {
          await User.updateMany({ roomId: roomId }, { nickname: "匿名参加者" });
          console.log(`[${roomId}] 全ての参加者のニックネームをリセットしました。`);
          socket.emit("nicknamesResetSuccess");
          broadcastQuizStatus(roomId);
        } catch (error) {
          console.error(`[${roomId}] ニックネームリセット中にエラー:`, error);
          socket.emit(
            "message",
            "ニックネームのリセット中にエラーが発生しました。"
          );
        }
      } else {
        // それ以外のクイズ進行制御コマンドの場合 (startQuiz, nextQuestion, endQuiz, showResults)
        if (!socket.isController) {
          // isController が true でなければブロック
          console.warn(
            "非コントローラーソケットからのコマンドをブロックしました:",
            socket.id,
            commandData.type
          );
          return;
        }
        console.log("コントローラーコマンドを受信:", commandData.type); // コントローラーコマンドのログ

        if (commandData.type === "startQuiz") {
          // restart: 途中のまま残っているクイズを破棄して最初から始める
          if (roomState.isQuizActive && !commandData.restart) return;
          await loadQuestions(roomId);
          roomState.resetGameState();
          roomState.isQuizActive = true;
          roomState.currentQuestionIndex = 0;
          if (roomState.questions.length === 0) {
            console.warn(`[${roomId}] 問題がありません。クイズを開始できません。`);
            socket.emit(
              "message",
              "問題がありません。クイズを開始できません。"
            );
            roomState.isQuizActive = false;
            broadcastQuizStatus(roomId);
            return;
          }

          await Answer.deleteMany({ roomId: roomId });
          await User.updateMany({ roomId: roomId }, { score: 0, scoreHistory: [] });
          console.log(`[${roomId}] 前回の回答とスコア履歴をリセットしました。`);

          io.to(roomId).emit("quizStarted");

          roomState.currentQuestionData = roomState.questions[roomState.currentQuestionIndex];
          roomState.currentQuestionResults = {
            questionId: roomState.currentQuestionData._id.toString(),
            totalVotes: 0,
            optionVotes: roomState.currentQuestionData.options.reduce(
              (acc, opt) => ({ ...acc, [opt.id]: 0 }),
              {}
            ),
            correctOptionId: roomState.currentQuestionData.correctOptionId,
            answeredUserIds: new Set(),
          };

          // ルーム内のソケットを取得
          const room = io.sockets.adapter.rooms.get(roomId);
          if (room) {
            room.forEach((socketId) => {
              const s = io.sockets.sockets.get(socketId);
              if (s && s.roomId === roomId) {
                try {
            if (!s.isAdmin && !s.isController) {
              s.emit("question", {
                      id: roomState.currentQuestionData._id.toString(),
                      text: roomState.currentQuestionData.text,
                      options: roomState.currentQuestionData.options,
                newScore: 0,
              });
              console.log(
                      `[${roomId}] [startQuiz] 参加者 ${s.id} に最初の問題とスコア0を送信。`
              );
            } else {
              s.emit("question", {
                      id: roomState.currentQuestionData._id.toString(),
                      text: roomState.currentQuestionData.text,
                      options: roomState.currentQuestionData.options,
              });
              console.log(
                      `[${roomId}] [startQuiz] 管理/コントローラー画面 ${s.id} に最初の問題を送信。`
              );
            }
                } catch (emitError) {
                  console.error(`[${roomId}] [startQuiz] 送信エラー (ソケット ${s.id}):`, emitError);
                }
              }
            });
          }
          console.log(`[${roomId}] クイズを開始しました。最初の問題を送信。`);
          // タイマーは自動開始しない（コントローラーの startTimer コマンドで開始）
          roomState.currentRemainingTime = roomState.QUESTION_DURATION;
          roomState.isShowingResults = false;
          roomState.answersOpen = false; // タイマー開始まで回答を受け付けない
          broadcastQuizStatus(roomId);
        } else if (commandData.type === "resyncQuestion") {
          // 表示画面の再読み込み後などに、進行中の問題をこのコントローラーへ送り直す
          if (!roomState.isQuizActive || !roomState.currentQuestionData) return;
          socket.emit("question", {
            id: roomState.currentQuestionData._id.toString(),
            text: roomState.currentQuestionData.text,
            options: roomState.currentQuestionData.options,
            resume: {
              timerStarted:
                roomState.answersOpen ||
                roomState.isShowingResults ||
                roomState.currentRemainingTime < roomState.QUESTION_DURATION,
            },
          });
          if (roomState.isShowingResults) {
            socket.emit("showQuestionResults", {
              questionId: roomState.currentQuestionResults.questionId,
              totalVotes: roomState.currentQuestionResults.totalVotes,
              optionVotes: roomState.currentQuestionResults.optionVotes,
              correctOptionId: roomState.currentQuestionResults.correctOptionId,
            });
          }
        } else if (commandData.type === "startTimer") {
          // 選択肢を出し切った後、コントローラーが手動でタイマーを開始する
          if (!roomState.isQuizActive) return;
          console.log(`[${roomId}] コントローラーがタイマーを開始しました。`);
          startQuestionTimer(roomId);
        } else if (commandData.type === "nextQuestion") {
          if (!roomState.isQuizActive) return;

          if (roomState.quizTimer) clearInterval(roomState.quizTimer);
          roomState.isShowingResults = false;
          await updateScoresForCurrentQuestion(roomId);

          roomState.currentQuestionIndex++;
          if (roomState.currentQuestionIndex < roomState.questions.length) {
            roomState.currentQuestionData = roomState.questions[roomState.currentQuestionIndex];
            roomState.currentQuestionResults = {
              questionId: roomState.currentQuestionData._id.toString(),
              totalVotes: 0,
              optionVotes: roomState.currentQuestionData.options.reduce(
                (acc, opt) => ({ ...acc, [opt.id]: 0 }),
                {}
              ),
              correctOptionId: roomState.currentQuestionData.correctOptionId,
              answeredUserIds: new Set(),
            };
            // ルーム内のソケットを取得してフラグをリセット
            const roomForReset = io.sockets.adapter.rooms.get(roomId);
            if (roomForReset) {
              roomForReset.forEach((socketId) => {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.roomId === roomId) {
                  roomState.socketAnsweredFlags.set(s.id, false);
            }
              });
            }

            // ルーム内のソケットに問題を送信
            const roomForQuestion = io.sockets.adapter.rooms.get(roomId);
            if (roomForQuestion) {
              roomForQuestion.forEach(async (socketId) => {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.roomId === roomId) {
              try {
                if (!s.isAdmin && !s.isController) {
                      const participantUser = await User.findOne({ _id: s.userId, roomId: roomId });
                  s.emit("question", {
                        id: roomState.currentQuestionData._id,
                        text: roomState.currentQuestionData.text,
                        options: roomState.currentQuestionData.options,
                    newScore: participantUser ? participantUser.score : 0,
                  });
                  console.log(
                        `[${roomId}] [nextQuestion] 参加者 ${s.id} (${
                      s.userId
                    }) に問題とスコアを送信。スコア: ${
                      participantUser ? participantUser.score : 0
                    }`
                  );
                } else {
                  s.emit("question", {
                        id: roomState.currentQuestionData._id.toString(),
                        text: roomState.currentQuestionData.text,
                        options: roomState.currentQuestionData.options,
                  });
                  console.log(
                        `[${roomId}] [nextQuestion] 管理/コントローラー画面 ${s.id} に問題を送信。`
                  );
                }
              } catch (emitError) {
                console.error(
                      `[${roomId}] [nextQuestion] 問題またはスコア送信中にエラー (ソケット ${s.id}):`,
                  emitError
                );
              }
            }
              });
            }
            console.log(`[${roomId}] 次の問題を送信しました。`);
            // タイマーは自動開始しない（コントローラーの startTimer コマンドで開始）
            roomState.currentRemainingTime = roomState.QUESTION_DURATION;
            roomState.isShowingResults = false;
            roomState.answersOpen = false; // タイマー開始まで回答を受け付けない
            broadcastQuizStatus(roomId);
          } else {
            await updateScoresForCurrentQuestion(roomId);

            const finalRankingData = await getFinalRanking(roomId);

            // ルーム内のソケットに終了メッセージを送信
            const roomForEnd = io.sockets.adapter.rooms.get(roomId);
            if (roomForEnd) {
              roomForEnd.forEach(async (socketId) => {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.roomId === roomId) {
              try {
                if (!s.isAdmin && !s.isController) {
                      const participantUser = await User.findOne({ _id: s.userId, roomId: roomId });
                  s.emit("quizEnded", {
                    message: "全問終了しました！",
                    finalScore: participantUser ? participantUser.score : 0,
                  });
                } else if (s.isController) {
                  s.emit("quizEnded", {
                    message: "全問終了しました。",
                    finalRanking: finalRankingData,
                  });
                } else {
                  s.emit("quizEnded", { message: "クイズが終了しました。" });
                }
              } catch (emitError) {
                console.error(
                      `[${roomId}] [nextQuestion-quizEnded] 終了メッセージ送信中にエラー (ソケット ${s.id}):`,
                  emitError
                );
              }
            }
              });
            }

            roomState.isQuizActive = false;
            roomState.currentQuestionIndex = -1;
            roomState.currentQuestionData = null;
            roomState.currentQuestionResults = {
              questionId: null,
              totalVotes: 0,
              optionVotes: {},
              correctOptionId: null,
              answeredUserIds: new Set(),
            };
            roomState.isShowingResults = false;
            // ルーム内のソケットのフラグをリセット
            const roomForFlags = io.sockets.adapter.rooms.get(roomId);
            if (roomForFlags) {
              roomForFlags.forEach((socketId) => {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.roomId === roomId) {
                  roomState.socketAnsweredFlags.set(s.id, false);
                }
              });
            }
            console.log(`[${roomId}] クイズが終了しました (全問終了)。`);
          }
        } else if (commandData.type === "endQuiz") {
          if (roomState.quizTimer) clearInterval(roomState.quizTimer);

          await updateScoresForCurrentQuestion(roomId);
          roomState.resetGameState();

          const finalRankingData = await getFinalRanking(roomId);

          console.log(`[${roomId}] 主催者によってクイズが終了されました。`);

          // ルーム内のソケットに終了メッセージを送信
          const roomForEndQuiz = io.sockets.adapter.rooms.get(roomId);
          if (roomForEndQuiz) {
            // forEachではなく、Promise.allを使用して非同期処理を適切に処理
            const promises = Array.from(roomForEndQuiz).map(async (socketId) => {
              const s = io.sockets.sockets.get(socketId);
              if (s && s.roomId === roomId) {
            try {
              if (!s.isAdmin && !s.isController) {
                    const participantUser = await User.findOne({ _id: s.userId, roomId: roomId });
                s.emit("quizEnded", {
                  message: "クイズが終了しました！",
                  finalScore: participantUser ? participantUser.score : 0,
                  finalRanking: finalRankingData,
                });
                console.log(
                      `[${roomId}] [endQuiz] 参加者 ${s.id} に最終スコア (${
                    participantUser ? participantUser.score : 0
                  }) を送信しました。`
                );
              } else if (s.isController) {
                s.emit("quizEnded", {
                  message: "クイズが終了しました。",
                  finalRanking: finalRankingData,
                });
              } else {
                s.emit("quizEnded", { message: "クイズが終了しました。" });
              }
            } catch (emitError) {
              console.error(
                    `[${roomId}] [endQuiz] 終了メッセージ送信中にエラー (ソケット ${s.id}):`,
                emitError
              );
            }
              }
            });
            await Promise.all(promises);
          }
        } else if (commandData.type === "showResults") {
          // 動画があるかどうかをチェック
          const hasVideo = roomState.currentQuestionData?.options?.some(
            (opt) => opt.videoUrl && opt.videoUrl.trim() !== ""
          );
          
          if (
            !roomState.isQuizActive ||
            (!hasVideo && roomState.currentRemainingTime > 0) ||
            !roomState.currentQuestionData
          ) {
            if (!hasVideo) {
            socket.emit("message", "まだ結果を表示できません。");
            }
            return;
          }
          console.log(`[${roomId}] 結果表示コマンドを受信しました。`);
          roomState.isShowingResults = true;
          roomState.answersOpen = false; // 結果表示で回答受付を締め切る
          broadcastQuestionResults(roomId);
          console.log(`[${roomId}] showResultsイベントをクライアントに送信しました。`);
        } else if (commandData.type === "resetQuizState") {
          if (!socket.isController) {
            console.warn(
              `[${roomId}] 非コントローラーソケットからのクイズ状態リセットコマンドをブロックしました:`,
              socket.id
            );
            socket.emit(
              "message",
              "クイズ状態のリセットはコントロール画面からのみ実行できます。"
            );
            return;
          }
          console.log(`[${roomId}] クイズ状態リセットコマンドを受信しました。`);
          try {
            roomState.resetGameState();
            await Answer.deleteMany({ roomId: roomId });
            await User.updateMany({ roomId: roomId }, { score: 0, scoreHistory: [] });
            console.log(`[${roomId}] データベースの回答とスコアもリセットしました。`);
            socket.emit("message", "クイズ状態をリセットしました。");
          } catch (error) {
            console.error(`[${roomId}] クイズ状態のリセット中にエラー:`, error);
            socket.emit(
              "message",
              "クイズ状態のリセット中にエラーが発生しました。"
            );
          }
        } else if (commandData.type === "returnToStart") {
          console.log(`[${roomId}] [hostCommand] returnToStart`);

          roomState.resetGameState();
          roomState.isQuizActive = false;
          roomState.isShowingResults = false;
          roomState.currentQuestionIndex = -1;

          io.to(roomId).emit("resetToStart");
          broadcastQuizStatus(roomId);
          return;
        }
      }
      broadcastQuizStatus();
    } catch (mainError) {
      // hostCommand 全体の try-catch の閉じ
      console.error(
        "hostCommand 処理中に予期せぬメインエラーが発生しました:",
        mainError
      );
    }
  });

  //ニックネーム設定イベント（ルーム対応）
  socket.on("setNickname", async (data) => {
    const roomId = socket.roomId || "default";
    if (data.nickname) {
      try {
        // 既存のUserドキュメントを更新（ルームIDでフィルタ）
        await User.findOneAndUpdate(
          { _id: socket.userId, roomId: roomId },
          { nickname: data.nickname }
        );
        console.log(
          `[${roomId}] ソケット ${socket.id} のニックネームを ${data.nickname} に設定しました。`
        );
        socket.emit("setNicknameSuccess", { nickname: data.nickname });
        broadcastQuizStatus(roomId);
      } catch (error) {
        console.error(`[${roomId}] ニックネーム設定エラー (ソケット ${socket.id}):`, error);
        socket.emit("message", "ニックネーム設定中にエラーが発生しました。");
      }
    }
  });

  // --- ここからが、この接続ソケット固有の初期設定処理（ルーム対応） ---
  // ユーザー情報をデータベースから取得または作成
  let user = await User.findOne({ socketId: socket.id, roomId: roomId });
  if (!user) {
    user = new User({ socketId: socket.id, roomId: roomId });
    await user.save();
    console.log(`[${roomId}] 新規ユーザー作成: ${user._id}`);
  } else {
    console.log(`[${roomId}] 既存ユーザー接続: ${user._id}`);
  }
  socket.userId = user._id;
  const roomState = getRoomState(roomId);
  roomState.socketAnsweredFlags.set(socket.id, false);

  // 接続したばかりのソケットに、暫定的な quizStatus を送信
  sendQuizStatusToSocket(socket);

  // クイズがアクティブで、かつコントローラーソケットではない場合に、現在の問題情報を送信
  if (
    roomState.isQuizActive &&
    roomState.currentQuestionData &&
    !socket.isAdmin &&
    !socket.isController
  ) {
    const currentUser = await User.findOne({ _id: socket.userId, roomId: roomId });
    socket.emit("question", {
      id: roomState.currentQuestionData._id.toString(),
      text: roomState.currentQuestionData.text,
      options: roomState.currentQuestionData.options,
      newScore: currentUser ? currentUser.score : 0,
    });
    socket.emit("countdown", roomState.currentRemainingTime);
    if (roomState.isShowingResults) {
      socket.emit("showQuestionResults", {
        questionId: roomState.currentQuestionResults.questionId,
        totalVotes: roomState.currentQuestionResults.totalVotes,
        optionVotes: roomState.currentQuestionResults.optionVotes,
        correctOptionId: roomState.currentQuestionResults.correctOptionId,
      });
    }
  } else if (!roomState.isQuizActive && !socket.isAdmin && !socket.isController) {
    socket.emit("message", "クイズはまだ開始されていません。");
  }
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log("Listening:", PORT));
