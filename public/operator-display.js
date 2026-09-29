// 運用者用表示画面JavaScript
// コンソールエラーを抑制（広告ブロッカーによるブロックを無視）
(function() {
  const originalError = console.error;
  console.error = function(...args) {
    // YouTubeのログイベントエラーは無視
    if (args.some(arg => 
      typeof arg === 'string' && 
      (arg.includes('ERR_BLOCKED_BY_CLIENT') || 
       arg.includes('youtube.com/youtubei/v1/log') ||
       arg.includes('net::ERR_BLOCKED_BY_CLIENT'))
    )) {
      return; // エラーを表示しない
    }
    originalError.apply(console, args);
  };
})();

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
    // タイトル画面の左下の画像（管理画面で設定されている時だけ表示）
    const titleCustomImage = document.getElementById("title-custom-image");
    if (titleCustomImage && statusData.titleImageUrl) {
      titleCustomImage.src = statusData.titleImageUrl;
      titleCustomImage.hidden = false;
    }
    
    // 参加用URLを更新（roomIdを含める）
    const joinUrl = `${location.origin}/?roomId=${currentRoomId}`;
    const joinUrlEl = document.getElementById("join-url");
    if (joinUrlEl) {
      joinUrlEl.textContent = joinUrl;
    }

    // クイズ開始前画面の初期化
    initializePreQuizScreen(joinUrl);

    // Socket.IO接続（roomIdを指定、ADMIN_KEYは使用しない）
    socket = io({
      query: { roomId: currentRoomId },
      auth: { roomId: currentRoomId },
    });

    setupSocketHandlers();
    setupEventListeners();
  } catch (error) {
    console.error("初期化エラー:", error);
    window.location.href = "/operator-login.html";
  }
})();

const displayStatusElement = document.getElementById("display-status");
const countdownElement = document.getElementById("countdown");
const questionTextElement = document.getElementById("question-text");
const optionsContainer = document.getElementById("options");

//クイズ制御ボタンとステータス表示のDOM要素取得
const startQuizBtnDisplay = document.getElementById("startQuizBtnDisplay");
const showResultsBtnDisplay = document.getElementById("showResultsBtnDisplay");
const nextQuestionBtnDisplay = document.getElementById("nextQuestionBtnDisplay");
const endQuizBtnDisplay = document.getElementById("endQuizBtnDisplay");

function $(id) {
  return document.getElementById(id);
}
function onClick(el, fn) {
  if (el) el.addEventListener("click", fn);
}
function setText(el, text) {
  if (el) el.textContent = text;
}
function setShow(el, show) {
  if (el) el.style.display = show ? "" : "none";
}

//初期状態で全てのクイズ制御ボタンを無効化
if (startQuizBtnDisplay) {
  startQuizBtnDisplay.disabled = true;
}
if (showResultsBtnDisplay) {
  showResultsBtnDisplay.style.display = "none";
}
if (nextQuestionBtnDisplay) {
  nextQuestionBtnDisplay.style.display = "none";
  nextQuestionBtnDisplay.disabled = true;
}
if (endQuizBtnDisplay) {
  endQuizBtnDisplay.disabled = true;
}

//クイズ終了メッセージとランキング関連のDOM要素
const quizEndMessageArea = document.getElementById("quiz-end-message-area");
const finalMessageElement = document.getElementById("final-message");
const rankingArea = document.getElementById("ranking-area");
const rankingList = document.getElementById("ranking-list");
const containerElement = document.querySelector(".container");

//戻るボタンのDOM要素
const returnToStartBtn = document.getElementById("return-to-start-btn");

const qrBadge = document.getElementById("join-qr-badge");
const preQuizScreen = document.getElementById("pre-quiz-screen");
const quizContainer = document.getElementById("quiz-container");
const preQuizStartBtn = document.getElementById("pre-quiz-start-btn");

// タイトル演出画面
const titleScreen = document.getElementById("title-screen");
const titleStartBtn = document.getElementById("title-start-btn");
const titleBgm = document.getElementById("title-bgm");

// ルール説明動画画面
const ruleScreen = document.getElementById("rule-screen");
const ruleVideo = document.getElementById("rule-video");
const ruleNextBtn = document.getElementById("rule-next-btn");

// 問題タイトル画面（03）
const qtitleScreen = document.getElementById("qtitle-screen");
const qtitleJingle = document.getElementById("qtitle-jingle");
const qtitleNextBtn = document.getElementById("qtitle-next-btn");

// 問題文と選択肢を表示する時の効果音（04）
const questionRevealSe = document.getElementById("question-reveal-se");

// カウントダウン中のBGM／時間切れのドラ／正解発表のピンポン
const questionBgm = document.getElementById("question-bgm");
const timeupSe = document.getElementById("timeup-se");
const answerSe = document.getElementById("answer-se");
// 最終ランキングのBGM
const rankingBgm = document.getElementById("ranking-bgm");

let currentQuestionId = null;
let countdownInterval = null;
let quizPhase = "waiting";
let timerStarted = false; // 現在の問題でタイマー（Enter手動開始）を開始済みか
let currentQuestionHasVideo = false; // 現在の問題が動画問題か（動画はタイマー無し）
let latestQuizStatus = null; // 最新のquizStatus（次の問題/最終問題の判定に使用）
let pendingQuizStart = false; // 問題タイトル画面から開始し、最初の問題の受信待ちか
let suppressAnswerSe = false; // 再読み込み復帰直後は正解発表の効果音を鳴らさない

// クイズ開始前画面の初期化
function initializePreQuizScreen(joinUrl) {
  // QRコード画像のURLを生成（QRコード生成APIを使用）
  // 例: https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=0&data=URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`;
  const qrCodeImg = document.getElementById("qr-code-img");
  if (qrCodeImg) {
    qrCodeImg.src = qrCodeUrl;
  }

  // 参加URLを表示
  const joinUrlDisplay = document.getElementById("join-url-display");
  if (joinUrlDisplay) {
    joinUrlDisplay.textContent = joinUrl;
  }

  // 待機画面の「クイズを始める」ボタン → タイトル演出へ
  if (preQuizStartBtn) {
    preQuizStartBtn.addEventListener("click", () => {
      showTitleScreen();
    });
  }

  // タイトル演出の「クイズを始める」ボタン → ルール動画へ
  if (titleStartBtn) {
    titleStartBtn.addEventListener("click", () => {
      hideTitleScreen();
      showRuleScreen();
    });
  }

  // ルール動画の「次へ」ボタン → 問題タイトル画面へ
  if (ruleNextBtn) {
    ruleNextBtn.addEventListener("click", () => {
      hideRuleScreen();
      showQtitleScreen();
    });
  }

  // 問題タイトル画面の「次へ」ボタン → クイズを開始し、最初の問題が届いたらクイズ本編へ
  // （空の「問題が表示されます」画面を挟まないため、切替は question 受信時に行う）
  if (qtitleNextBtn) {
    qtitleNextBtn.addEventListener("click", () => {
      if (latestQuizStatus && latestQuizStatus.isActive) {
        // 前回のクイズが途中のまま（リハーサルの残り・表示画面の再読み込みなど）
        const restart = confirm(
          "前回のクイズが途中のままです。\n\n" +
            "［OK］最初からやり直す（スコアもリセット）\n" +
            "［キャンセル］進行中の問題から再開する"
        );
        pendingQuizStart = true;
        if (restart) {
          socket.emit("hostCommand", { type: "startQuiz", restart: true });
        } else {
          socket.emit("hostCommand", { type: "resyncQuestion" });
        }
        return;
      }
      if (latestQuizStatus && latestQuizStatus.totalQuestions > 0) {
        pendingQuizStart = true;
        socket.emit("hostCommand", { type: "startQuiz" });
        return;
      }
      hideQtitleScreen();
      showQuizScreen();
    });
  }

}

// タイトル演出画面を表示（待機画面の後・クイズ本編前）
function showTitleScreen() {
  if (preQuizScreen) {
    preQuizScreen.classList.add("hidden");
  }
  if (titleScreen) {
    titleScreen.classList.remove("hidden");
  }
  // BGMを再生（ブラウザの自動再生制限に配慮）
  if (titleBgm) {
    titleBgm.currentTime = 0;
    titleBgm.volume = 0.7;
    const p = titleBgm.play();
    if (p && p.catch) {
      p.catch((e) => console.warn("BGMの自動再生に失敗:", e));
    }
  }
  // 背景動画を再生
  const titleBgVideo = document.getElementById("title-bg-video");
  if (titleBgVideo) {
    titleBgVideo.play().catch((e) => console.warn("背景動画の再生に失敗:", e));
  }
}

// タイトル演出画面を隠す
function hideTitleScreen() {
  if (titleScreen) {
    titleScreen.classList.add("hidden");
  }
  // BGMを停止
  if (titleBgm) {
    titleBgm.pause();
    titleBgm.currentTime = 0;
  }
  const titleBgVideo = document.getElementById("title-bg-video");
  if (titleBgVideo) {
    titleBgVideo.pause();
  }
}

// ルール説明動画を表示して再生
function showRuleScreen() {
  if (ruleScreen) {
    ruleScreen.classList.remove("hidden");
  }
  if (ruleVideo) {
    ruleVideo.currentTime = 0;
    const p = ruleVideo.play();
    if (p && p.catch) {
      p.catch((e) => console.warn("ルール動画の再生に失敗:", e));
    }
  }
}

// ルール説明動画を隠す
function hideRuleScreen() {
  if (ruleVideo) {
    ruleVideo.pause();
  }
  if (ruleScreen) {
    ruleScreen.classList.add("hidden");
  }
}

// 問題タイトル画面（03）を表示してジングルを再生
function showQtitleScreen() {
  if (qtitleScreen) {
    qtitleScreen.classList.remove("hidden");
  }
  if (qtitleJingle) {
    qtitleJingle.currentTime = 0;
    qtitleJingle.volume = 0.8;
    const p = qtitleJingle.play();
    if (p && p.catch) {
      p.catch((e) => console.warn("ジングルの再生に失敗:", e));
    }
  }
}

// 問題タイトル画面を隠す
function hideQtitleScreen() {
  if (qtitleJingle) {
    qtitleJingle.pause();
    qtitleJingle.currentTime = 0;
  }
  if (qtitleScreen) {
    qtitleScreen.classList.add("hidden");
  }
}

// 問題文と選択肢を全て「非表示（未表示）」状態に戻す
function resetOptionReveal() {
  if (questionTextElement) {
    questionTextElement.classList.add("text-pending");
    questionTextElement.classList.remove("text-revealed");
  }
  document.querySelectorAll("#options .option").forEach((opt) => {
    opt.classList.add("reveal-pending");
    opt.classList.remove("revealed");
  });
}

// 問題表示の効果音を頭から鳴らす
function playQuestionRevealSe() {
  if (!questionRevealSe) return;
  questionRevealSe.currentTime = 0;
  const p = questionRevealSe.play();
  if (p && p.catch) {
    p.catch((e) => console.warn("効果音の再生に失敗:", e));
  }
}

// 効果音を頭から鳴らす（自動再生ブロック時は警告のみ）
function playSe(audio, volume = 1) {
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = volume;
  const p = audio.play();
  if (p && p.catch) {
    p.catch((e) => console.warn("効果音の再生に失敗:", e));
  }
}

// カウントダウン中のBGMを止める
function stopQuestionBgm() {
  if (!questionBgm) return;
  questionBgm.pause();
  questionBgm.currentTime = 0;
}

// 最終ランキングのBGMを止める
function stopRankingBgm() {
  if (!rankingBgm) return;
  rankingBgm.pause();
  rankingBgm.currentTime = 0;
}

// 未表示の問題文と選択肢A〜Dをまとめて表示する。表示できたら true
function revealQuestion() {
  const textPending =
    questionTextElement &&
    questionTextElement.classList.contains("text-pending");
  const pendingOptions = document.querySelectorAll(
    "#options .option.reveal-pending"
  );
  if (!textPending && pendingOptions.length === 0) return false;

  if (textPending) {
    questionTextElement.classList.remove("text-pending");
    questionTextElement.classList.add("text-revealed");
  }
  pendingOptions.forEach((opt) => {
    opt.classList.remove("reveal-pending");
    opt.classList.add("revealed");
  });
  return true;
}

// Enterキーでクイズ進行を1手ずつ進める（開始→選択肢表示→タイマー→結果→次の問題→終了）
// 進めたら true を返す（Enterを乗っ取ってボタンの誤操作を防ぐ）
function handleQuizEnter() {
  // クイズ本編が表示されている時だけ
  if (!quizContainer || quizContainer.style.display === "none") return false;

  // 1) クイズ未開始 → クイズ開始（Enterで開始。開始ボタンは非表示）
  if (quizPhase === "waiting") {
    if (latestQuizStatus && latestQuizStatus.totalQuestions > 0) {
      socket.emit("hostCommand", { type: "startQuiz" });
      return true;
    }
    return false;
  }

  // 2) 出題中：問題文と選択肢A〜Dを1回のEnterでまとめて表示（効果音付き）
  if (revealQuestion()) {
    playQuestionRevealSe();
    return true;
  }

  // 3) 選択肢を出し切ったら、タイマー（＝回答受付）を手動開始
  //    非動画：カウントダウン開始／動画：回答受付のみ開始
  if (!timerStarted) {
    socket.emit("hostCommand", { type: "startTimer" });
    timerStarted = true;
    // タイマー開始と同時にカウントダウンを表示（動画問題は表示しない）
    if (!currentQuestionHasVideo && countdownElement) {
      countdownElement.style.display = "";
    }
    // カウントダウン中のBGM（動画問題は動画の音を優先して鳴らさない）
    if (!currentQuestionHasVideo) {
      playSe(questionBgm, 0.8);
    }
    return true;
  }

  // 4) タイマー開始後
  if (quizPhase === "question") {
    // 非動画：カウントダウン中 → 時間切れ（timeup）まで待つ
    return true;
  }

  // 動画の待機／時間切れ → 結果を表示
  if (quizPhase === "waitingResult" || quizPhase === "timeup") {
    if (
      showResultsBtnDisplay &&
      showResultsBtnDisplay.style.display !== "none"
    ) {
      showResultsBtnDisplay.click();
    }
    return true;
  }

  // 5) 結果表示中 → 「次へ」。最終問題ではサーバー側で自動的に
  //    ランキング（終了画面）が表示される。専用の終了操作は不要。
  if (quizPhase === "results") {
    socket.emit("hostCommand", { type: "nextQuestion" });
    // サーバーからの応答（次の問題 or 終了）まで二重送信を防ぐ
    quizPhase = "advancing";
    return true;
  }

  // ended など：何もしない
  return false;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (handleQuizEnter()) {
    e.preventDefault();
  }
});

// 問題切替時の登場アニメを再生（クラスを付け直してCSSアニメを再起動）
function retriggerQuizEnter() {
  if (!containerElement) return;
  containerElement.classList.remove("q-enter");
  // 強制リフローでアニメーションをリセット
  void containerElement.offsetWidth;
  containerElement.classList.add("q-enter");
}

// クイズ画面を表示
function showQuizScreen() {
  if (preQuizScreen) {
    preQuizScreen.classList.add("hidden");
  }
  if (quizContainer) {
    quizContainer.style.display = "block";
  }
  // クイズ中の左下QRコードバッジは表示しない
}

// クイズ開始前画面に戻る
function resetToPreQuizScreen() {
  if (preQuizScreen) {
    preQuizScreen.classList.remove("hidden");
  }
  if (quizContainer) {
    quizContainer.style.display = "none";
  }
  if (qrBadge) {
    qrBadge.style.display = "none";
  }
}

function setupSocketHandlers() {
  socket.on("quizStatus", (status) => {
    if (!qrBadge) return;

    qrBadge.classList.toggle("is-hidden", status.isActive);
    qrBadge.classList.toggle("is-running", status.isActive);
    qrBadge.classList.toggle("is-finished", !status.isActive);
  });

  socket.on("connect", () => {
    console.log("controllerConnectイベントを送信しようとしています。");
    setText(displayStatusElement, "サーバーに接続済み (コントローラー)");
    console.log("Display connected to server - socket ID:", socket.id);
    socket.emit("controllerConnect");
    console.log("controllerConnectイベントを送信しました。");
  });

  socket.on("disconnect", () => {
    startQuizBtnDisplay.disabled = true;
    showResultsBtnDisplay.style.display = "none";
    nextQuestionBtnDisplay.disabled = true;
    endQuizBtnDisplay.disabled = true;
  });

  // クイズ開始イベント
  socket.on("quizStarted", () => {
    stopRankingBgm();
    containerElement.classList.remove("quiz-ended-layout");
    quizEndMessageArea.style.display = "none";
    rankingArea.style.display = "none";
    returnToStartBtn.style.display = "none";

    optionsContainer.classList.add("during-question");
    optionsContainer.classList.remove("showing-results");
    quizPhase = "question";
    showResultsBtnDisplay.style.display = "none";
  });

  // サーバーから問題データが送られてきた時
  socket.on("question", (questionData) => {
    // 問題タイトル画面から開始した場合は、問題が揃ってからクイズ画面に切り替える
    if (pendingQuizStart) {
      pendingQuizStart = false;
      hideQtitleScreen();
      showQuizScreen();
    }
    currentQuestionId = questionData.id;
    resetResultsUI();
    questionTextElement.textContent = questionData.text;
    const hasVideo = renderOptions(questionData.options);
    // 問題切替の登場アニメを再生
    retriggerQuizEnter();
    // 問題文と選択肢は最初は隠し、Enterでまとめて表示する
    resetOptionReveal();
    // 進行状態をリセット（Enter駆動の状態機械用）
    timerStarted = false;
    stopQuestionBgm();
    currentQuestionHasVideo = hasVideo;
    containerElement.classList.remove("quiz-ended-layout");
    quizEndMessageArea.style.display = "none";
    rankingArea.style.display = "none";
    returnToStartBtn.style.display = "none";

    optionsContainer.classList.add("during-question");
    optionsContainer.classList.remove("showing-results");
    quizPhase = "question";
    
    // 動画がある場合はカウントダウンを非表示にして、結果表示ボタンを最初から表示
    if (hasVideo) {
      if (countdownElement) {
        countdownElement.style.display = "none";
      }
      showResultsBtnDisplay.style.display = "inline-block";
      quizPhase = "waitingResult";
      console.log("[question] 動画があるため、カウントダウンを非表示にして結果表示ボタンを表示");
    } else {
      if (countdownElement) {
        // カウントダウンは最初から残り秒数（満タン）で表示し、Enterで開始する
        countdownElement.style.display = "";
        countdownElement.textContent =
          latestQuizStatus && latestQuizStatus.timerDuration !== undefined
            ? latestQuizStatus.timerDuration
            : "--";
        countdownElement.style.color = "#ffda6a";
      }
      showResultsBtnDisplay.style.display = "none";
      console.log("[question] 動画がないため、カウントダウンを表示（Enterで開始）");
    }

    // 進行中の問題から再開した場合は、問題文と選択肢をすべて表示済みにする
    if (questionData.resume) {
      // 復帰直後に届く結果表示ではピンポンを鳴らさない
      suppressAnswerSe = true;
      setTimeout(() => (suppressAnswerSe = false), 1000);
      revealQuestion();
      timerStarted = !!questionData.resume.timerStarted;
      if (timerStarted && !hasVideo && countdownElement) {
        countdownElement.style.display = "";
      }
    }
  });

  socket.on("showCorrectAnswer", (data) => {
    showCorrectAnswer(data.correctOptionId);
  });

  // サーバーからカウントダウン情報を受信
  socket.on("countdown", (remainingTime) => {
    // 動画がある場合はカウントダウンを無視
    const hasVideoInCurrentQuestion = document.querySelectorAll("#options .option.has-video").length > 0;
    if (hasVideoInCurrentQuestion) {
      console.log("[countdown] 動画があるため、カウントダウンを無視");
      return;
    }
    
    if (countdownElement) {
      countdownElement.textContent = remainingTime;
    }

    if (remainingTime <= 3 && remainingTime > 0) {
      if (countdownElement) {
        countdownElement.style.color = "red";
      }
      return;
    }

    if (remainingTime === 0) {
      // 時間切れ：BGMを止めてドラを鳴らす（BGM再生中＝この画面でタイマーを開始した時だけ）
      if (quizPhase === "question" && questionBgm && !questionBgm.paused) {
        stopQuestionBgm();
        playSe(timeupSe);
      }
      if (countdownElement) {
        countdownElement.textContent = 0;
        countdownElement.style.color = "orange";
      }

      if (quizPhase === "question") {
        quizPhase = "waitingResult";
        showResultsBtnDisplay.style.display = "inline-block";
        nextQuestionBtnDisplay.style.display = "none";
      }
      return;
    }

    if (countdownElement) {
      countdownElement.style.color = "#ffda6a";
    }
  });

  // サーバーから結果表示データを受信
  socket.on("showQuestionResults", (results) => {
    console.log("[showQuestionResults] イベントを受信しました");
    console.log("[showQuestionResults] 受信したresults:", results);
    console.log("[showQuestionResults] currentQuestionId:", currentQuestionId);
    console.log("[showQuestionResults] results.questionId:", results.questionId);
    
    if (String(results.questionId) !== String(currentQuestionId)) {
      console.log("[showQuestionResults] 問題IDが一致しないため、処理をスキップします");
      return;
    }

    console.log("[showQuestionResults] 結果を表示します");
    // 正解発表のピンポン（再受信・再読み込みでの復帰時は鳴らさない）
    if (quizPhase !== "results" && !suppressAnswerSe) {
      stopQuestionBgm();
      playSe(answerSe);
    }
    quizPhase = "results";

    document.querySelectorAll("#options .option").forEach((card) => {
      const id = card.dataset.id;

      card.classList.remove("correct", "incorrect");

      if (id === results.correctOptionId) {
        card.classList.add("correct");
      } else {
        card.classList.add("incorrect");
      }

      const votes =
        results.optionVotes && results.optionVotes[id]
          ? results.optionVotes[id]
          : 0;

      let voteEl = card.querySelector(".vote-count-display");
      if (!voteEl) {
        voteEl = document.createElement("div");
        voteEl.className = "vote-count-display";
        card.appendChild(voteEl);
      }
      voteEl.textContent = `${votes}票`;
    });

    showResultsBtnDisplay.style.display = "none";
    nextQuestionBtnDisplay.disabled = false;
    nextQuestionBtnDisplay.style.display = "inline-block";
  });

  // クイズ終了イベント
  socket.on("quizEnded", (data) => {
    console.log("[quizEnded] クイズ終了イベントを受信しました, data:", data);
    finalMessageElement.textContent = data.message || "終了";
    countdownElement.textContent = "";
    countdownElement.style.color = "white";

    optionsContainer.classList.remove("during-question", "showing-results");
    showResultsBtnDisplay.style.display = "none";
    quizPhase = "ended";
    startQuizBtnDisplay.disabled = true;
    nextQuestionBtnDisplay.disabled = true;
    endQuizBtnDisplay.disabled = true;

    containerElement.classList.add("quiz-ended-layout");
    quizEndMessageArea.style.display = "flex";
    
    // カウントダウン中のBGMを止めて、ランキングのBGMを流す（ループ）
    stopQuestionBgm();
    playSe(rankingBgm, 0.8);

    console.log("[quizEnded] finalRanking:", data.finalRanking);
    if (data.finalRanking && data.finalRanking.length > 0) {
      console.log("[quizEnded] ランキングを表示します");
      renderRanking(data.finalRanking);
      rankingArea.style.display = "block";
    } else {
      console.log("[quizEnded] ランキングデータがありません（参加者がいない可能性があります）");
      // 参加者がいない場合でも、ランキングエリアを表示してメッセージを表示
      rankingList.innerHTML =
        '<li class="rank-empty">参加者がいませんでした。</li>';
      rankingArea.style.display = "block";
    }

    returnToStartBtn.style.display = "inline-block";
  });

  socket.on("resetToStart", () => {
    console.log("[display] resetToStart received");

    // 動画画面に戻る
    resetToPreQuizScreen();
    stopQuestionBgm();
    stopRankingBgm();

    containerElement.classList.remove("quiz-ended-layout");
    quizEndMessageArea.style.display = "none";
    rankingArea.style.display = "none";
    returnToStartBtn.style.display = "none";

    ensureOptionCards();
    questionTextElement.classList.remove("text-pending", "text-revealed");
    questionTextElement.textContent = "問題が表示されます";

    renderOptions([
      { id: "A", text: " " },
      { id: "B", text: " " },
      { id: "C", text: " " },
      { id: "D", text: " " },
    ]);

    resetResultsUI();
    optionsContainer.classList.add("during-question");
    optionsContainer.classList.remove("showing-results");
    showResultsBtnDisplay.style.display = "none";
    nextQuestionBtnDisplay.style.display = "none";
    nextQuestionBtnDisplay.disabled = true;

    if (countdownElement) {
      countdownElement.textContent = "--";
      countdownElement.style.color = "#ffda6a";
    }
  });

  //クイズステータスの更新を受信
  socket.on("quizStatus", (status) => {
    console.log("--- quizStatus イベント受信 ---");
    console.log("受信したステータスデータ:", status);
    latestQuizStatus = status;

    if (status.isActive) {
      if (status.remainingTime <= 0) {
        if (quizPhase !== "results") quizPhase = "timeup";
      } else {
        if (quizPhase !== "results") quizPhase = "question";
      }
    }

    if (status.isController) {
      console.log(
        "[display.js-quizStatus] サーバーからコントローラーとして認識されました。"
      );
      setText(displayStatusElement, "サーバーに接続済み (コントローラー)");
      if (status.isActive) {
        console.log("[display.js-quizStatus] クイズ進行中。");
        startQuizBtnDisplay.disabled = true;
        endQuizBtnDisplay.disabled = false;

        if (quizPhase === "question" || quizPhase === "waiting") {
          // 動画がある場合は結果表示ボタンを表示
          const hasVideoInCurrentQuestion = document.querySelectorAll("#options .option.has-video").length > 0;
          if (hasVideoInCurrentQuestion) {
            showResultsBtnDisplay.style.display = "inline-block";
            quizPhase = "waitingResult";
          } else {
            showResultsBtnDisplay.style.display = "none";
          }
          nextQuestionBtnDisplay.disabled = true;
        } else if (quizPhase === "waitingResult") {
          // 動画がある場合の待機状態
          showResultsBtnDisplay.style.display = "inline-block";
          nextQuestionBtnDisplay.style.display = "none";
        } else if (quizPhase === "timeup") {
          showResultsBtnDisplay.style.display = "inline-block";
          endQuizBtnDisplay.style.display = "inline-block";
          nextQuestionBtnDisplay.style.display = "none";
        } else if (quizPhase === "results") {
          showResultsBtnDisplay.style.display = "none";
          nextQuestionBtnDisplay.disabled =
            status.currentQuestionIndex >= status.totalQuestions - 1;
        } else if (quizPhase === "ended") {
          showResultsBtnDisplay.style.display = "none";
          nextQuestionBtnDisplay.disabled = true;
          startQuizBtnDisplay.disabled = true;
          endQuizBtnDisplay.disabled = true;
        }
      } else {
        console.log("[display.js-quizStatus] クイズ停止中。");
        console.log("問題数:", status.totalQuestions, "isController:", status.isController);
        console.log("statusオブジェクト全体:", JSON.stringify(status, null, 2));
        if (startQuizBtnDisplay) {
          const shouldDisable = status.totalQuestions === 0 || !status.totalQuestions;
          startQuizBtnDisplay.disabled = shouldDisable;
          console.log("クイズ開始ボタンの状態:", shouldDisable ? "無効（問題数が0または未定義）" : "有効", "totalQuestions:", status.totalQuestions);
        }
        if (nextQuestionBtnDisplay) {
          nextQuestionBtnDisplay.disabled = true;
        }
        if (endQuizBtnDisplay) {
          endQuizBtnDisplay.disabled = true;
        }
        if (showResultsBtnDisplay) {
          showResultsBtnDisplay.style.display = "none";
        }
        quizPhase = "waiting";

        if (status.timerDuration !== undefined && countdownElement) {
          if (
            countdownElement.textContent === "--" ||
            countdownElement.textContent === "10"
          ) {
            countdownElement.textContent = status.timerDuration;
            countdownElement.style.color = "#ffda6a";
          }
        }
      }

      if (!socket.sentControllerConnect) {
        socket.emit("controllerConnect");
        console.log(
          "controllerConnectイベントを送信しました (quizStatus受信後)。"
        );
        socket.sentControllerConnect = true;
      }
    } else {
      console.log(
        "[display.js-quizStatus] サーバーの応答を待機中... (isController: false)"
      );
      setText(
        displayStatusElement,
        "サーバーの応答を待機中... (コントローラー認証中)"
      );
      startQuizBtnDisplay.disabled = true;
      showResultsBtnDisplay.style.display = "none";
      nextQuestionBtnDisplay.disabled = true;
      endQuizBtnDisplay.disabled = true;
    }
  });
}

function setupEventListeners() {
  // クイズ制御ボタンのイベントリスナー
  if (startQuizBtnDisplay) {
    console.log("[setupEventListeners] startQuizBtnDisplay要素を発見しました");
    startQuizBtnDisplay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(
        "[display] start clicked. disabled=",
        startQuizBtnDisplay.disabled,
        "element:",
        startQuizBtnDisplay
      );
      if (startQuizBtnDisplay.disabled) {
        console.warn("クイズ開始ボタンが無効化されています");
        return;
      }
      if (!socket || !socket.connected) {
        console.error("Socket.IOが接続されていません");
        return;
      }
      console.log("クイズ開始コマンドを送信します");
      socket.emit("hostCommand", { type: "startQuiz" });
    });
    // デバッグ用：ボタンの状態を定期的に確認
    setInterval(() => {
      if (startQuizBtnDisplay) {
        console.log("[デバッグ] クイズ開始ボタンの状態:", {
          disabled: startQuizBtnDisplay.disabled,
          display: window.getComputedStyle(startQuizBtnDisplay).display,
          visibility: window.getComputedStyle(startQuizBtnDisplay).visibility,
          pointerEvents: window.getComputedStyle(startQuizBtnDisplay).pointerEvents,
          zIndex: window.getComputedStyle(startQuizBtnDisplay).zIndex
        });
      }
    }, 5000);
  } else {
    console.error("startQuizBtnDisplay要素が見つかりません");
  }

  if (showResultsBtnDisplay) {
    showResultsBtnDisplay.addEventListener("click", () => {
      console.log("[showResultsBtnDisplay] 結果表示ボタンがクリックされました");
      console.log("[showResultsBtnDisplay] 現在のquizPhase:", quizPhase);
      console.log("[showResultsBtnDisplay] 現在のcurrentQuestionId:", currentQuestionId);
      socket.emit("hostCommand", { type: "showResults" });
      console.log("[showResultsBtnDisplay] hostCommandを送信しました");
      // サーバーからの応答を待つため、ここではボタンの表示を変更しない
      // showQuestionResultsイベントで処理される
    });
  }

  if (nextQuestionBtnDisplay) {
    nextQuestionBtnDisplay.addEventListener("click", () => {
      socket.emit("hostCommand", { type: "nextQuestion" });
      quizPhase = "question";
      nextQuestionBtnDisplay.style.display = "none";
      showResultsBtnDisplay.style.display = "none";
    });
  }

  if (endQuizBtnDisplay) {
    endQuizBtnDisplay.addEventListener("click", () => {
      socket.emit("hostCommand", { type: "endQuiz" });
    });
  }

  //戻るボタンのイベントリスナー
  returnToStartBtn.onclick = () => {
    if (
      !confirm("開始画面に戻りますか？現在のクイズ状態はリセットされます。")
    )
      return;
    socket.emit("hostCommand", { type: "returnToStart" });
    console.log("開始画面に戻るコマンドを送信しました。");
  };
}

//ランキングを描画する関数
function renderRanking(ranking) {
  rankingList.innerHTML = "";
  if (ranking.length === 0) {
    rankingList.innerHTML =
      '<li class="rank-empty">ランキングデータがありません。</li>';
    return;
  }
  ranking.forEach((entry, index) => {
    const rank = index + 1;
    const li = document.createElement("li");
    li.className = `rank-${rank}`;
    // 下位から順に登場させ、1位を最後に出す
    li.style.setProperty("--i", ranking.length - 1 - index);

    const badge = document.createElement("span");
    badge.className = "rank-badge";
    badge.innerHTML = `${rank}<small>位</small>`;

    // ニックネームは参加者の入力なので textContent で入れる
    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = entry.nickname || "匿名";

    const score = document.createElement("span");
    score.className = "rank-score";
    score.innerHTML = `${Number(entry.score) || 0}<small>問正解</small>`;
    if (typeof entry.totalAnswerTime === "number") {
      const time = document.createElement("span");
      time.className = "rank-time";
      time.textContent = `${Math.round(entry.totalAnswerTime * 10) / 10}秒`;
      score.appendChild(time);
    }

    li.append(badge, name, score);
    rankingList.appendChild(li);
  });
  console.log("ランキングデータ:", ranking);
}

function renderOptions(options) {
  let hasVideo = false; // 動画があるかどうかのフラグ
  
  document.querySelectorAll("#options .option").forEach((card) => {
    const id = card.dataset.id;
    const opt = options.find((o) => o.id === id);

    const img = card.querySelector(".option-image");
    const video = card.querySelector(".option-video");
    const text = card.querySelector(".option-text");

    card.classList.remove(
      "has-image",
      "has-video",
      "has-text",
      "correct",
      "incorrect",
      "correct-answer",
      "incorrect-answer"
    );

    card.querySelectorAll(".vote-count-display").forEach((el) => el.remove());

    if (img) {
      img.removeAttribute("src");
      img.alt = "";
      img.style.display = "";
    }
    if (video) {
      video.pause(); // 動画を停止
      video.removeAttribute("src");
      video.src = "";
      video.load(); // 動画をリセット
      video.style.display = "";
    }
    if (text) {
      text.textContent = "";
    }

    if (!opt) return;

    // 優先順位: 動画 > 画像 > テキスト
    if (opt.videoUrl && opt.videoUrl.trim() !== "") {
      hasVideo = true; // 動画があることを記録
      if (video) {
        video.src = opt.videoUrl;
        video.load(); // 動画を読み込む
        video.style.display = "block";
        card.classList.add("has-video");
        console.log(`[renderOptions] 選択肢${id}に動画を設定: ${opt.videoUrl}`);
        // 動画のエラーハンドリング
        video.onerror = (e) => {
          console.error(`[renderOptions] 選択肢${id}の動画読み込みエラー:`, e);
          console.error(`動画URL: ${opt.videoUrl}`);
        };
        video.onloadeddata = () => {
          console.log(`[renderOptions] 選択肢${id}の動画読み込み完了`);
        };
      }
    } else if (opt.imageUrl && opt.imageUrl.trim() !== "") {
      if (img) {
        img.src = opt.imageUrl;
        img.alt = opt.text ? `${id}：${opt.text}` : `${id}の画像`;
        card.classList.add("has-image");
      }
    } else {
      if (text) {
        text.textContent = opt.text || "";
        card.classList.add("has-text");
      }
    }
  });
  
  return hasVideo; // 動画があるかどうかを返す
}

function showCorrectAnswer(correctOptionId) {
  document.querySelectorAll("#options .option").forEach((card) => {
    const id = card.dataset.id;
    card.classList.remove("correct", "incorrect");
    if (id === correctOptionId) {
      card.classList.add("correct");
    } else {
      card.classList.add("incorrect");
    }
  });
}

function resetResultsUI() {
  document.querySelectorAll(".result-bar-container").forEach((c) => {
    c.classList.remove("correct-answer", "incorrect-answer");
    c.classList.add("hide-results-elements");

    const fill = c.querySelector(".result-bar-fill");
    if (fill) {
      fill.style.width = "0%";
      fill.style.display = "none";
      fill.textContent = "";
    }

    const vote = c.querySelector(".vote-count");
    if (vote) {
      vote.textContent = "0票";
      vote.style.display = "none";
    }
  });

  document.querySelectorAll("#options .option").forEach((card) => {
    card.classList.remove("correct", "incorrect");
  });

  document.querySelectorAll(".vote-count-display").forEach((el) => el.remove());
}

function ensureOptionCards() {
  const existing = document.querySelectorAll("#options .option");
  if (existing.length === 4) return;

  optionsContainer.innerHTML = `
    <div class="option" data-id="A">
      <div class="option-label">A</div>
      <img class="option-image" alt="" />
      <div class="option-text"></div>
    </div>
    <div class="option" data-id="B">
      <div class="option-label">B</div>
      <img class="option-image" alt="" />
      <div class="option-text"></div>
    </div>
    <div class="option" data-id="C">
      <div class="option-label">C</div>
      <img class="option-image" alt="" />
      <div class="option-text"></div>
    </div>
    <div class="option" data-id="D">
      <div class="option-label">D</div>
      <img class="option-image" alt="" />
      <div class="option-text"></div>
    </div>
  `;
}
