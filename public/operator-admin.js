// 運用者用管理画面JavaScript
let currentRoomId = null;
let socket = null;

// ログイン状態確認と初期化
(async function init() {
  try {
    const statusResponse = await fetch("/api/auth/operator/status", {
      credentials: "include",
    });
    const statusData = await statusResponse.json();

    if (!statusData.isLoggedIn) {
      window.location.href = "/operator-login.html";
      return;
    }

    currentRoomId = statusData.roomId;
    document.getElementById("roomIdDisplay").textContent = `ルームID: ${currentRoomId}`;

    // Socket.IO接続（roomIdを指定）
    socket = io({
      query: { roomId: currentRoomId },
      auth: { roomId: currentRoomId },
    });

    setupSocketHandlers();
    setupEventListeners();
    fetchQuestions();
    fetchTimerDuration();
    loadTitleImageInfo();
  } catch (error) {
    console.error("初期化エラー:", error);
    window.location.href = "/operator-login.html";
  }
})();

const adminStatusElement = document.getElementById("admin-status");
const connectedUsersElement = document.getElementById("connected-users");
const currentQuestionDisplay = document.getElementById("current-question-display");
const currentQuestionIndexDisplay = document.getElementById(
  "current-question-index"
);
const totalQuestionsDisplay = document.getElementById("total-questions");
const quizActiveStatusDisplay = document.getElementById("quiz-active-status");
const resetNicknamesBtn = document.getElementById("resetNicknamesBtn");
const logoutBtn = document.getElementById("logoutBtn");
const openDisplayBtn = document.getElementById("openDisplayBtn");

// タイマー設定関連の要素
const timerDurationInput = document.getElementById("timerDuration");
const saveTimerBtn = document.getElementById("saveTimerBtn");
const timerStatusElement = document.getElementById("timer-status");

const addQuestionForm = document.getElementById("add-question-form");
const questionTextElement = document.getElementById("questionText");
const optionAElement = document.getElementById("optionA");
const optionBElement = document.getElementById("optionB");
const optionCElement = document.getElementById("optionC");
const optionDElement = document.getElementById("optionD");
const correctOptionElement = document.getElementById("correctOption");
const questionListElement = document.getElementById("question-list");
const optionAImageUrlEl = document.getElementById("optionAImageUrl");
const optionBImageUrlEl = document.getElementById("optionBImageUrl");
const optionCImageUrlEl = document.getElementById("optionCImageUrl");
const optionDImageUrlEl = document.getElementById("optionDImageUrl");
const optionAVideoUrlEl = document.getElementById("optionAVideoUrl");
const optionBVideoUrlEl = document.getElementById("optionBVideoUrl");
const optionCVideoUrlEl = document.getElementById("optionCVideoUrl");
const optionDVideoUrlEl = document.getElementById("optionDVideoUrl");

uploadImageAndSetUrl(
  document.getElementById("optionAImageFile"),
  document.getElementById("optionAImageUrl")
);
uploadImageAndSetUrl(
  document.getElementById("optionBImageFile"),
  document.getElementById("optionBImageUrl")
);
uploadImageAndSetUrl(
  document.getElementById("optionCImageFile"),
  document.getElementById("optionCImageUrl")
);
uploadImageAndSetUrl(
  document.getElementById("optionDImageFile"),
  document.getElementById("optionDImageUrl")
);

// 動画アップロード関数
async function uploadVideoAndSetUrl(fileInputEl, urlInputEl) {
  fileInputEl.addEventListener("change", async () => {
    const file = fileInputEl.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("video", file);

    const res = await fetch("/api/upload-video", {
      method: "POST",
      credentials: "include",
      body: fd,
    });

    if (!res.ok) {
      const text = await res.text();
      alert("動画アップロードに失敗しました: " + res.status + " " + text);
      return;
    }

    const data = await res.json();
    urlInputEl.value = data.url;
  });
}

uploadVideoAndSetUrl(
  document.getElementById("optionAVideoFile"),
  document.getElementById("optionAVideoUrl")
);
uploadVideoAndSetUrl(
  document.getElementById("optionBVideoFile"),
  document.getElementById("optionBVideoUrl")
);
uploadVideoAndSetUrl(
  document.getElementById("optionCVideoFile"),
  document.getElementById("optionCVideoUrl")
);
uploadVideoAndSetUrl(
  document.getElementById("optionDVideoFile"),
  document.getElementById("optionDVideoUrl")
);

function setupSocketHandlers() {
  // サーバー接続時の処理
  socket.on("connect", () => {
    adminStatusElement.textContent = "サーバーに接続済み (運用者)";
    console.log("Operator connected to server - socket ID:", socket.id);
    socket.emit("adminConnect");

    fetchQuestions();
    fetchTimerDuration();
  });

  socket.on("disconnect", () => {
    adminStatusElement.textContent = "サーバーから切断されました";
    if (resetNicknamesBtn) resetNicknamesBtn.disabled = true;
    console.log("Operator disconnected from server");
  });

  // 参加者数の更新を受信
  socket.on("updateUserCount", (count) => {
    connectedUsersElement.textContent = count;
  });

  socket.on("quizStatus", (status) => {
    console.log("--- operator-admin.js - quizStatus イベント受信 ---");
    console.log("受信したステータスデータ:", status);

    if (status.isAdmin) {
      adminStatusElement.textContent = "サーバーに接続済み (運用者)";
      resetNicknamesBtn.disabled = false;
    } else {
      adminStatusElement.textContent = "サーバーの応答を待機中... (認証中)";
      resetNicknamesBtn.disabled = true;
    }

    currentQuestionDisplay.textContent = status.currentQuestionText || "なし";
    currentQuestionIndexDisplay.textContent =
      status.currentQuestionIndex !== -1 ? status.currentQuestionIndex + 1 : "-";
    totalQuestionsDisplay.textContent = status.totalQuestions;
    quizActiveStatusDisplay.textContent = status.isActive ? "進行中" : "停止中";

    if (status.connectedUsers !== undefined) {
      connectedUsersElement.textContent = status.connectedUsers;
    }

    if (status.timerDuration !== undefined && timerDurationInput) {
      timerDurationInput.value = status.timerDuration;
    }
  });

  // サーバーから問題リスト更新の通知を受け取る
  socket.on("questionsUpdated", () => {
    fetchQuestions();
  });

  // ニックネームリセット成功の通知
  socket.on("nicknamesResetSuccess", () => {
    alert("全ての参加者のニックネームをリセットしました！");
  });
}

function setupEventListeners() {
  // 表示画面を開くボタン
  if (openDisplayBtn) {
    openDisplayBtn.addEventListener("click", () => {
      // 新しいタブで表示画面を開く
      window.open("/operator-display.html", "_blank");
    });
  }

  // ログアウトボタン
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/operator/logout", {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/operator-login.html";
    } catch (error) {
      console.error("ログアウトエラー:", error);
    }
  });

  // タイマー保存ボタン
  if (saveTimerBtn) {
    saveTimerBtn.onclick = saveTimerDuration;
  }

  // ニックネームリセットボタン
  resetNicknamesBtn.onclick = () => {
    if (
      confirm(
        "本当に全ての参加者のニックネームをリセットしますか？この操作は元に戻せません。"
      )
    ) {
      socket.emit("hostCommand", { type: "resetNicknames" });
      console.log("ニックネームリセットコマンドを送信しました。");
    }
  };

  // 問題追加フォーム
  addQuestionForm.onsubmit = async (e) => {
    e.preventDefault();

    const body = {
      text: questionTextElement.value,
      correctOptionId: correctOptionElement.value.toUpperCase(),
      options: [
        {
          id: "A",
          text: optionAElement.value,
          imageUrl: optionAImageUrlEl.value.trim(),
          videoUrl: optionAVideoUrlEl.value.trim(),
        },
        {
          id: "B",
          text: optionBElement.value,
          imageUrl: optionBImageUrlEl.value.trim(),
          videoUrl: optionBVideoUrlEl.value.trim(),
        },
        {
          id: "C",
          text: optionCElement.value,
          imageUrl: optionCImageUrlEl.value.trim(),
          videoUrl: optionCVideoUrlEl.value.trim(),
        },
        {
          id: "D",
          text: optionDElement.value,
          imageUrl: optionDImageUrlEl.value.trim(),
          videoUrl: optionDVideoUrlEl.value.trim(),
        },
      ],
    };

    const editingId = editingQuestionIdEl?.value?.trim();
    const url = editingId ? `/api/questions/${editingId}` : "/api/questions";
    const method = editingId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (response.ok) {
        alert(editingId ? "問題を更新しました！" : "問題を追加しました！");
        cancelEdit();
        fetchQuestions();
      } else {
        if (response.status === 401) {
          window.location.href = "/operator-login.html";
          return;
        }
        const err = await response.json().catch(() => ({}));
        alert(
          (editingId ? "更新" : "追加") +
            "に失敗: " +
            (err.message || response.status)
        );
      }
    } catch (error) {
      console.error("送信エラー:", error);
      alert("通信エラーが発生しました。");
    }
  };
}

// タイマー時間を取得する関数
async function fetchTimerDuration() {
  try {
    const response = await fetch("/api/timer-duration", {
      credentials: "include",
    });
    if (response.status === 401) {
      window.location.href = "/operator-login.html";
      return;
    }
    if (response.ok) {
      const data = await response.json();
      if (timerDurationInput) {
        timerDurationInput.value = data.duration;
      }
    }
  } catch (error) {
    console.error("タイマー時間の取得中にエラーが発生しました:", error);
  }
}

// タイマー時間を保存する関数
async function saveTimerDuration() {
  const duration = parseInt(timerDurationInput.value, 10);

  if (isNaN(duration) || duration < 1 || duration > 300) {
    if (timerStatusElement) {
      timerStatusElement.textContent =
        "タイマー時間は1秒以上300秒以下である必要があります。";
      timerStatusElement.style.color = "red";
    }
    return;
  }

  try {
    const response = await fetch("/api/timer-duration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ duration }),
    });

    if (response.status === 401) {
      window.location.href = "/operator-login.html";
      return;
    }

    if (response.ok) {
      const data = await response.json();
      if (timerStatusElement) {
        timerStatusElement.textContent = `タイマー時間を ${data.duration} 秒に設定しました。`;
        timerStatusElement.style.color = "lightgreen";
      }
      console.log(`タイマー時間を ${data.duration} 秒に設定しました。`);
    } else {
      const error = await response.json().catch(() => ({}));
      if (timerStatusElement) {
        timerStatusElement.textContent =
          error.message || "タイマー時間の設定に失敗しました。";
        timerStatusElement.style.color = "red";
      }
    }
  } catch (error) {
    console.error("タイマー時間の設定中にエラーが発生しました:", error);
    if (timerStatusElement) {
      timerStatusElement.textContent = "通信エラーが発生しました。";
      timerStatusElement.style.color = "red";
    }
  }
}

// 問題リストの描画
function renderQuestions(questions) {
  questionListElement.innerHTML = "";
  if (questions.length === 0) {
    questionListElement.innerHTML = "<p>問題がありません。</p>";
    return;
  }
  questions.forEach((q, index) => {
    const item = document.createElement("div");
    item.classList.add("question-item");
    item.innerHTML = `
            <span>${index + 1}. ${q.text} (正解: ${q.correctOptionId})</span>
            <div>
                <button data-id="${q._id}" class="edit-btn">編集</button>
                <button data-id="${q._id}" class="delete-btn">削除</button>
            </div>
        `;
    questionListElement.appendChild(item);
  });

  // 編集・削除ボタンにイベントリスナーを追加
  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.onclick = (e) => deleteQuestion(e.target.dataset.id);
  });
  document.querySelectorAll(".edit-btn").forEach((button) => {
    button.onclick = (e) => startEdit(e.target.dataset.id);
  });
}

// サーバーから問題リストをフェッチ
async function fetchQuestions() {
  try {
    const response = await fetch("/api/questions", {
      credentials: "include",
    });
    if (response.status === 401) {
      window.location.href = "/operator-login.html";
      return;
    }
    const questions = await response.json();
    renderQuestions(questions);
  } catch (error) {
    console.error("問題の取得中にエラーが発生しました:", error);
    questionListElement.innerHTML =
      '<p style="color:red;">問題のロードに失敗しました。</p>';
  }
}

// 問題削除関数
async function deleteQuestion(id) {
  if (!confirm("本当にこの問題を削除しますか？")) {
    return;
  }
  try {
    const response = await fetch(`/api/questions/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (response.status === 401) {
      window.location.href = "/operator-login.html";
      return;
    }
    if (response.ok) {
      alert("問題を削除しました！");
      fetchQuestions();
    } else {
      alert("問題の削除に失敗しました。");
    }
  } catch (error) {
    console.error("問題の削除中にエラーが発生しました:", error);
    alert("問題の削除中にエラーが発生しました。");
  }
}

const editingQuestionIdEl = document.getElementById("editingQuestionId");
const submitQuestionBtn = document.getElementById("submitQuestionBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

async function startEdit(id) {
  const res = await fetch("/api/questions", {
    credentials: "include",
  });
  if (res.status === 401) {
    window.location.href = "/operator-login.html";
    return;
  }
  const list = await res.json();
  const q = list.find((x) => x._id === id);
  if (!q) return alert("対象の問題が見つかりませんでした。");

  console.log("[startEdit] 編集する問題データ:", q);
  console.log("[startEdit] 選択肢データ:", q.options);

  // フォームに流し込み
  questionTextElement.value = q.text || "";
  
  // 選択肢データを取得
  const optA = q.options?.find((o) => o.id === "A");
  const optB = q.options?.find((o) => o.id === "B");
  const optC = q.options?.find((o) => o.id === "C");
  const optD = q.options?.find((o) => o.id === "D");

  // テキスト
  optionAElement.value = optA?.text || "";
  optionBElement.value = optB?.text || "";
  optionCElement.value = optC?.text || "";
  optionDElement.value = optD?.text || "";

  // 画像URL
  optionAImageUrlEl.value = optA?.imageUrl || "";
  optionBImageUrlEl.value = optB?.imageUrl || "";
  optionCImageUrlEl.value = optC?.imageUrl || "";
  optionDImageUrlEl.value = optD?.imageUrl || "";

  // 動画URL
  const videoUrlA = optA?.videoUrl || "";
  const videoUrlB = optB?.videoUrl || "";
  const videoUrlC = optC?.videoUrl || "";
  const videoUrlD = optD?.videoUrl || "";
  
  console.log("[startEdit] 動画URL - A:", videoUrlA, "B:", videoUrlB, "C:", videoUrlC, "D:", videoUrlD);
  
  optionAVideoUrlEl.value = videoUrlA;
  optionBVideoUrlEl.value = videoUrlB;
  optionCVideoUrlEl.value = videoUrlC;
  optionDVideoUrlEl.value = videoUrlD;
  
  correctOptionElement.value = (q.correctOptionId || "").toUpperCase();

  editingQuestionIdEl.value = id;
  if (submitQuestionBtn) submitQuestionBtn.textContent = "更新する";
  if (cancelEditBtn) cancelEditBtn.style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  editingQuestionIdEl.value = "";
  addQuestionForm.reset();
  if (submitQuestionBtn) submitQuestionBtn.textContent = "問題を追加";
  if (cancelEditBtn) cancelEditBtn.style.display = "none";
}

if (cancelEditBtn) cancelEditBtn.onclick = cancelEdit;

async function uploadImageAndSetUrl(fileInputEl, urlInputEl) {
  fileInputEl.addEventListener("change", async () => {
    const file = fileInputEl.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("image", file);

    const res = await fetch("/api/upload-image", {
      method: "POST",
      credentials: "include",
      body: fd,
    });

    if (!res.ok) {
      const text = await res.text();
      alert("画像アップロードに失敗しました: " + res.status + " " + text);
      return;
    }

    const data = await res.json();
    urlInputEl.value = data.url;
  });
}

// タイトル画面の左右の画像（新郎新婦など）
const titleMiniCaption = document.getElementById("title-mini-caption");

const TITLE_IMAGE_MAX_SIZE = 2000; // 背景抜き時の最大辺（大きすぎる画像は縮小）

// 画像の外周の色（背景色）を調べる。外周のピクセルの色ごとの中央値を使うので、
// 縁に人物などが少しかかっていても背景色を拾える
function detectBackgroundColor(px, w, h) {
  const rs = [];
  const gs = [];
  const bs = [];
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    if (px[i + 3] < 128) return; // すでに透明な所は数えない
    rs.push(px[i]);
    gs.push(px[i + 1]);
    bs.push(px[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.max(w, h) / 400)); // 間引いて軽くする
  for (let x = 0; x < w; x += step) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    add(0, y);
    add(w - 1, y);
  }
  if (!rs.length) return null;
  const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return [median(rs), median(gs), median(bs)];
}

// 画像の外周から続く背景色（白・グレー・青などの単色）の部分だけを透明にしたPNGを返す
async function removeSolidBackground(file, tolerance) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TITLE_IMAGE_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  // 背景色からの距離（0＝背景色と同じ）。RGBのうち一番離れている成分で測る
  const bg = detectBackgroundColor(px, w, h) || [255, 255, 255];
  const distance = (i) =>
    Math.max(
      Math.abs(px[i * 4] - bg[0]),
      Math.abs(px[i * 4 + 1] - bg[1]),
      Math.abs(px[i * 4 + 2] - bg[2])
    );
  const isBackground = (i) => px[i * 4 + 3] === 0 || distance(i) <= tolerance;

  // 外周の背景色から塗りつぶし（内側の同じ色の部分は残す）
  const removed = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => {
    if (!removed[i] && isBackground(i)) {
      removed[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }

  for (let i = 0; i < w * h; i++) {
    if (removed[i]) {
      px[i * 4 + 3] = 0;
      continue;
    }
    // 抜いた部分に接するフチは半透明にして白いギザギザを目立たなくする
    const x = i % w;
    const touches =
      (x > 0 && removed[i - 1]) ||
      (x < w - 1 && removed[i + 1]) ||
      (i >= w && removed[i - w]) ||
      (i < w * (h - 1) && removed[i + w]);
    if (touches) {
      const t = Math.min(1, (distance(i) - tolerance) / Math.max(tolerance, 1));
      px[i * 4 + 3] = Math.round(px[i * 4 + 3] * Math.max(0.15, t));
    }
  }

  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG変換に失敗"))), "image/png")
  );
}

// 1枚分（左 or 右）の設定欄
function createTitleImageSlot(side) {
  const root = document.querySelector(`.title-image-slot[data-side="${side}"]`);
  if (!root) return null;
  const q = (selector) => root.querySelector(selector);
  return {
    side,
    fileInput: q(".title-image-file"),
    removeWhite: q(".title-image-remove-white"),
    tolerance: q(".title-image-tolerance"),
    uploadBtn: q(".title-image-upload"),
    status: q(".title-image-status"),
    removeArea: q(".title-image-remove-area"),
    removeBtn: q(".title-image-remove"),
    previewImg: document.querySelector(`.title-mini-custom[data-side="${side}"]`),
    savedUrl: null, // 保存済みの画像URL
    localUrl: null, // 選択中（未アップロード）の画像のURL
    processedBlob: null, // 白抜き済みの画像（アップロードに使う）
    token: 0, // 連続操作時に古い処理結果で上書きしないための番号
  };
}

const titleImageSlots = ["left", "right"]
  .map(createTitleImageSlot)
  .filter(Boolean);

function setSlotStatus(slot, text, color = "#bbb") {
  slot.status.textContent = text;
  slot.status.style.color = color;
}

// ミニプレビューを更新（未アップロードの画像があればそちらを優先）
function updateTitleMiniPreview(busySlot = null) {
  const unsaved = [];
  titleImageSlots.forEach((slot) => {
    const src = slot.localUrl || slot.savedUrl;
    if (src) {
      slot.previewImg.src = src;
      slot.previewImg.hidden = false;
    } else {
      slot.previewImg.removeAttribute("src");
      slot.previewImg.hidden = true;
    }
    if (slot.localUrl) unsaved.push(slot.side === "left" ? "左" : "右");
  });

  if (!titleMiniCaption) return;
  if (busySlot) {
    titleMiniCaption.textContent = "背景を透明にしています...";
  } else if (unsaved.length) {
    titleMiniCaption.textContent = `プレビュー（${unsaved.join("・")}はまだアップロードされていません）`;
  } else {
    titleMiniCaption.textContent = "プレビュー";
  }
}

// 選択中のファイルをプレビューに反映（白抜きONなら処理後の画像）
async function updateLocalSlotPreview(slot) {
  const token = ++slot.token;
  if (slot.localUrl) URL.revokeObjectURL(slot.localUrl);
  slot.localUrl = null;
  slot.processedBlob = null;

  const file = slot.fileInput.files?.[0];
  const removeWhite = !!slot.removeWhite.checked;
  slot.tolerance.disabled = !removeWhite;
  if (!file) {
    updateTitleMiniPreview();
    return;
  }

  let blob = file;
  if (removeWhite) {
    updateTitleMiniPreview(slot);
    try {
      blob = await removeSolidBackground(file, Number(slot.tolerance.value));
    } catch (error) {
      console.error("背景の除去エラー:", error);
      if (token !== slot.token) return;
      setSlotStatus(slot, "この画像は背景の除去ができませんでした", "#e74c3c");
      blob = file;
    }
    if (token !== slot.token) return; // より新しい操作があった
    if (blob !== file) slot.processedBlob = blob;
  }

  slot.localUrl = URL.createObjectURL(blob);
  updateTitleMiniPreview();
}

async function uploadSlotImage(slot) {
  const file = slot.fileInput.files?.[0];
  if (!file) {
    setSlotStatus(slot, "ファイルを選択してください", "#e74c3c");
    return;
  }
  if (slot.removeWhite.checked && !slot.localUrl) {
    setSlotStatus(slot, "背景を透明にしています。少し待ってからもう一度押してください", "#e74c3c");
    return;
  }

  setSlotStatus(slot, "アップロード中...", "#61dafb");

  const fd = new FormData();
  if (slot.processedBlob) {
    // 背景を抜いた画像は透明を保つためPNGで送る
    const baseName = file.name.replace(/\.[^.]+$/, "") || "title-image";
    fd.append("image", slot.processedBlob, `${baseName}.png`);
  } else {
    fd.append("image", file);
  }

  try {
    const res = await fetch(`/api/upload-title-image?side=${slot.side}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });

    if (!res.ok) {
      setSlotStatus(slot, "アップロードに失敗しました: " + res.status, "#e74c3c");
      return;
    }

    setSlotStatus(slot, "アップロード成功！表示画面を再読み込みすると反映されます", "#1f8f4a");
    slot.fileInput.value = "";
    slot.token++;
    if (slot.localUrl) URL.revokeObjectURL(slot.localUrl);
    slot.localUrl = null;
    slot.processedBlob = null;
    loadTitleImageInfo();
  } catch (error) {
    console.error("タイトル画像アップロードエラー:", error);
    setSlotStatus(slot, "アップロード中にエラーが発生しました", "#e74c3c");
  }
}

async function removeSlotImage(slot) {
  const label = slot.side === "left" ? "左下" : "右下";
  if (!confirm(`タイトル画面の${label}の画像を削除しますか？`)) return;

  try {
    const res = await fetch(`/api/operator/title-image?side=${slot.side}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      alert("画像の削除に失敗しました");
      return;
    }
    setSlotStatus(slot, "画像を削除しました", "#1f8f4a");
    slot.savedUrl = null;
    slot.removeArea.style.display = "none";
    updateTitleMiniPreview();
  } catch (error) {
    console.error("タイトル画像削除エラー:", error);
    alert("画像の削除中にエラーが発生しました");
  }
}

titleImageSlots.forEach((slot) => {
  // ファイル選択・白抜きの切替・強さの変更で、アップロード前でもプレビューに反映する
  slot.fileInput.addEventListener("change", () => updateLocalSlotPreview(slot));
  slot.removeWhite.addEventListener("change", () => updateLocalSlotPreview(slot));
  // ドラッグ中は重いので、指を離した時に処理する
  slot.tolerance.addEventListener("change", () => updateLocalSlotPreview(slot));
  slot.uploadBtn.addEventListener("click", () => uploadSlotImage(slot));
  slot.removeBtn.addEventListener("click", () => removeSlotImage(slot));
});

// 保存済みの画像（左右）とロゴの名前を読み込む
async function loadTitleImageInfo() {
  try {
    const response = await fetch("/api/auth/operator/status", {
      credentials: "include",
    });
    const statusData = await response.json();
    if (!statusData.isLoggedIn) return;

    const savedUrls = {
      left: statusData.titleImageUrl || null,
      right: statusData.titleImageRightUrl || null,
    };
    titleImageSlots.forEach((slot) => {
      slot.savedUrl = savedUrls[slot.side];
      slot.removeArea.style.display = slot.savedUrl ? "block" : "none";
    });
    updateTitleMiniPreview();

    // 最終ランキングで1人ずつ発表する人数（初回だけ入力欄に入れる）
    if (rankingRevealCountInput && !rankingRevealCountLoaded) {
      rankingRevealCountLoaded = true;
      rankingRevealCountInput.value = statusData.rankingRevealCount ?? 5;
    }

    // タイトルロゴの名前（初回だけ入力欄に入れる。入力中の内容は上書きしない）
    if (titleNamesInput && !titleNamesLoaded) {
      titleNamesLoaded = true;
      titleNamesInput.value = statusData.titleNames || "";
      applyLogoNames(titleMiniLogo, titleNamesInput.value);
    }
  } catch (error) {
    console.error("タイトル画像情報の取得エラー:", error);
  }
}

// タイトルロゴの名前（「新郎新婦の」の代わり）
const titleNamesInput = document.getElementById("titleNamesInput");
const saveTitleNamesBtn = document.getElementById("saveTitleNamesBtn");
const titleNamesStatusElement = document.getElementById("title-names-status");
const titleMiniLogo = document.getElementById("title-mini-logo");
let titleNamesLoaded = false; // 保存済みの名前を入力欄に読み込んだか

// 入力中の名前をプレビューのロゴに反映する
if (titleNamesInput) {
  titleNamesInput.addEventListener("input", () => {
    applyLogoNames(titleMiniLogo, titleNamesInput.value);
  });
}

if (saveTitleNamesBtn) {
  saveTitleNamesBtn.addEventListener("click", async () => {
    titleNamesStatusElement.textContent = "保存中...";
    titleNamesStatusElement.style.color = "#61dafb";

    try {
      const res = await fetch("/api/operator/title-names", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titleNames: titleNamesInput.value }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        titleNamesStatusElement.textContent = data.message || `保存に失敗しました: ${res.status}`;
        titleNamesStatusElement.style.color = "#e74c3c";
        return;
      }

      titleNamesInput.value = data.titleNames;
      applyLogoNames(titleMiniLogo, data.titleNames);
      titleNamesStatusElement.textContent = data.titleNames
        ? "保存しました！表示画面・参加者画面を再読み込みすると反映されます"
        : "名前を消して、元のロゴに戻しました";
      titleNamesStatusElement.style.color = "#1f8f4a";
    } catch (error) {
      console.error("タイトルロゴの名前の保存エラー:", error);
      titleNamesStatusElement.textContent = "保存中にエラーが発生しました";
      titleNamesStatusElement.style.color = "#e74c3c";
    }
  });
}

// 最終ランキングで1人ずつ発表する人数
const rankingRevealCountInput = document.getElementById("rankingRevealCountInput");
const saveRankingRevealCountBtn = document.getElementById("saveRankingRevealCountBtn");
const rankingRevealStatusElement = document.getElementById("ranking-reveal-status");
let rankingRevealCountLoaded = false; // 保存済みの人数を入力欄に読み込んだか

if (saveRankingRevealCountBtn) {
  saveRankingRevealCountBtn.addEventListener("click", async () => {
    rankingRevealStatusElement.textContent = "保存中...";
    rankingRevealStatusElement.style.color = "#61dafb";
    try {
      const res = await fetch("/api/operator/ranking-reveal-count", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingRevealCount: Number(rankingRevealCountInput.value) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        rankingRevealStatusElement.textContent = data.message || `保存に失敗しました: ${res.status}`;
        rankingRevealStatusElement.style.color = "#e74c3c";
        return;
      }
      rankingRevealCountInput.value = data.rankingRevealCount;
      rankingRevealStatusElement.textContent = `保存しました！上位${data.rankingRevealCount}人をEnterで1人ずつ発表します`;
      rankingRevealStatusElement.style.color = "#1f8f4a";
    } catch (error) {
      console.error("発表人数の保存エラー:", error);
      rankingRevealStatusElement.textContent = "保存中にエラーが発生しました";
      rankingRevealStatusElement.style.color = "#e74c3c";
    }
  });
}
