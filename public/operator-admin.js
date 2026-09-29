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

// タイトル画面（左下）の画像
const titleImageFileInput = document.getElementById("titleImageFile");
const uploadTitleImageBtn = document.getElementById("uploadTitleImageBtn");
const titleImageStatusElement = document.getElementById("title-image-status");
const titleImagePreviewDiv = document.getElementById("title-image-preview");
const titleImagePreviewImg = document.getElementById("title-image-preview-img");
const removeTitleImageBtn = document.getElementById("removeTitleImageBtn");

if (uploadTitleImageBtn) {
  uploadTitleImageBtn.addEventListener("click", async () => {
    const file = titleImageFileInput?.files?.[0];
    if (!file) {
      titleImageStatusElement.textContent = "ファイルを選択してください";
      titleImageStatusElement.style.color = "#e74c3c";
      return;
    }

    if (titleImageRemoveWhite?.checked && !localTitleImageUrl) {
      titleImageStatusElement.textContent = "白い背景を透明にしています。少し待ってからもう一度押してください";
      titleImageStatusElement.style.color = "#e74c3c";
      return;
    }

    titleImageStatusElement.textContent = "アップロード中...";
    titleImageStatusElement.style.color = "#61dafb";

    const fd = new FormData();
    if (processedTitleImageBlob) {
      // 白背景を抜いた画像は透明を保つためPNGで送る
      const baseName = file.name.replace(/\.[^.]+$/, "") || "title-image";
      fd.append("image", processedTitleImageBlob, `${baseName}.png`);
    } else {
      fd.append("image", file);
    }

    try {
      const res = await fetch("/api/upload-title-image", {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      if (!res.ok) {
        titleImageStatusElement.textContent = "アップロードに失敗しました: " + res.status;
        titleImageStatusElement.style.color = "#e74c3c";
        return;
      }

      titleImageStatusElement.textContent = "アップロード成功！表示画面を再読み込みすると反映されます";
      titleImageStatusElement.style.color = "#1f8f4a";
      titleImageFileInput.value = "";
      titlePreviewToken++;
      if (localTitleImageUrl) URL.revokeObjectURL(localTitleImageUrl);
      localTitleImageUrl = null;
      processedTitleImageBlob = null;
      loadTitleImageInfo();
    } catch (error) {
      console.error("タイトル画像アップロードエラー:", error);
      titleImageStatusElement.textContent = "アップロード中にエラーが発生しました";
      titleImageStatusElement.style.color = "#e74c3c";
    }
  });
}

// ミニプレビューの左下に画像を出す（src が空なら画像なし）
const titleMiniCaption = document.getElementById("title-mini-caption");
let savedTitleImageUrl = null; // 保存済みの画像URL
let localTitleImageUrl = null; // 選択中（未アップロード）の画像のURL

function setTitlePreview(src, caption) {
  if (src) {
    titleImagePreviewImg.src = src;
    titleImagePreviewImg.hidden = false;
  } else {
    titleImagePreviewImg.removeAttribute("src");
    titleImagePreviewImg.hidden = true;
  }
  if (titleMiniCaption) titleMiniCaption.textContent = caption;
}

function showSavedTitlePreview() {
  setTitlePreview(
    savedTitleImageUrl,
    savedTitleImageUrl ? "プレビュー（保存済みの画像）" : "プレビュー（画像なし）"
  );
}

// 白い背景を透明にする設定
const titleImageRemoveWhite = document.getElementById("titleImageRemoveWhite");
const titleImageWhiteTolerance = document.getElementById("titleImageWhiteTolerance");
let processedTitleImageBlob = null; // 白抜き済みの画像（アップロードに使う）
let titlePreviewToken = 0; // 連続操作時に古い処理結果で上書きしないための番号

const TITLE_IMAGE_MAX_SIZE = 2000; // 白抜き時の最大辺（大きすぎる画像は縮小）

// 画像の外周から続く白っぽい部分だけを透明にしたPNGを返す
async function removeWhiteBackground(file, tolerance) {
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
  // 白からの距離（0＝真っ白）
  const distance = (i) => 255 - Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  const isBackground = (i) => px[i * 4 + 3] === 0 || distance(i) <= tolerance;

  // 外周の白から塗りつぶし（内側の白い部分は残す）
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

// 選択中のファイルをプレビューに反映（白抜きONなら処理後の画像）
async function updateLocalTitlePreview() {
  const token = ++titlePreviewToken;
  if (localTitleImageUrl) URL.revokeObjectURL(localTitleImageUrl);
  localTitleImageUrl = null;
  processedTitleImageBlob = null;

  const file = titleImageFileInput.files?.[0];
  const removeWhite = !!titleImageRemoveWhite?.checked;
  if (titleImageWhiteTolerance) titleImageWhiteTolerance.disabled = !removeWhite;
  if (!file) {
    showSavedTitlePreview();
    return;
  }

  let blob = file;
  if (removeWhite) {
    if (titleMiniCaption) titleMiniCaption.textContent = "白い背景を透明にしています...";
    try {
      blob = await removeWhiteBackground(file, Number(titleImageWhiteTolerance.value));
    } catch (error) {
      console.error("白背景の除去エラー:", error);
      if (token !== titlePreviewToken) return;
      titleImageStatusElement.textContent = "この画像は白背景の除去ができませんでした";
      titleImageStatusElement.style.color = "#e74c3c";
      blob = file;
    }
    if (token !== titlePreviewToken) return; // より新しい操作があった
    if (blob !== file) processedTitleImageBlob = blob;
  }

  localTitleImageUrl = URL.createObjectURL(blob);
  setTitlePreview(
    localTitleImageUrl,
    processedTitleImageBlob
      ? "プレビュー（白背景を除去・まだアップロードされていません）"
      : "プレビュー（まだアップロードされていません）"
  );
}

// ファイル選択・白抜きの切替・強さの変更で、アップロード前でもプレビューに反映する
if (titleImageFileInput) {
  titleImageFileInput.addEventListener("change", updateLocalTitlePreview);
}
if (titleImageRemoveWhite) {
  titleImageRemoveWhite.addEventListener("change", updateLocalTitlePreview);
}
if (titleImageWhiteTolerance) {
  // ドラッグ中は重いので、指を離した時に処理する
  titleImageWhiteTolerance.addEventListener("change", updateLocalTitlePreview);
}

// タイトル画像の情報を読み込む
async function loadTitleImageInfo() {
  try {
    const response = await fetch("/api/auth/operator/status", {
      credentials: "include",
    });
    const statusData = await response.json();

    savedTitleImageUrl =
      statusData.isLoggedIn && statusData.titleImageUrl ? statusData.titleImageUrl : null;
    titleImagePreviewDiv.style.display = savedTitleImageUrl ? "block" : "none";
    // 未アップロードの画像を選択中なら、そちらのプレビューを優先する
    if (!localTitleImageUrl) showSavedTitlePreview();
  } catch (error) {
    console.error("タイトル画像情報の取得エラー:", error);
  }
}

// タイトル画像の削除
if (removeTitleImageBtn) {
  removeTitleImageBtn.addEventListener("click", async () => {
    if (!confirm("タイトル画面の画像を削除しますか？")) {
      return;
    }

    try {
      const res = await fetch("/api/operator/title-image", {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        alert("画像の削除に失敗しました");
        return;
      }

      titleImageStatusElement.textContent = "画像を削除しました";
      titleImageStatusElement.style.color = "#1f8f4a";
      titleImagePreviewDiv.style.display = "none";
      savedTitleImageUrl = null;
      if (!localTitleImageUrl) showSavedTitlePreview();
    } catch (error) {
      console.error("タイトル画像削除エラー:", error);
      alert("画像の削除中にエラーが発生しました");
    }
  });
}
