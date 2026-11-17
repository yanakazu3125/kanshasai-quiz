// タイトルロゴ（logo-names.css とセット）
// wrap: .logo-wrap 要素 / names: 管理画面で入力した名前（空なら「新郎新婦」）
const LOGO_DEFAULT_NAMES = "新郎新婦";

function buildLogo(wrap) {
  if (wrap.querySelector(".kz-logo")) return;
  // 文字の重なり（白フチ・金の厚み）は ::before に data-text の文字を描いて作る
  const part = (cls, text) =>
    `<span class="kz-t ${cls}" data-text="${text}">${text}</span>`;
  wrap.innerHTML = `
    <div class="kz-logo" role="img">
      <div class="kz-t kz-logo-names"></div>
      <div class="kz-logo-main">
        ${part("kz-love", "ラブ")}${part("kz-ga", "が")}${part("kz-sugoi", "スゴい")}${part("kz-quiz", "クイズ")}
      </div>
      ${part("kz-logo-gp", "GP")}
    </div>`;
}

function applyLogoNames(wrap, names) {
  if (!wrap) return;
  buildLogo(wrap);

  const text = (names || "").trim() || LOGO_DEFAULT_NAMES;
  // 元のロゴと同じく、名前の後ろに「の」を付ける
  const label = text.endsWith("の") ? text : `${text}の`;

  const line = wrap.querySelector(".kz-logo-names");
  line.textContent = label;
  line.dataset.text = label;

  // 文字幅の目安（全角＝1、英大文字・数字＝0.85、その他の半角＝0.7）。
  // 極太フォントは英字も幅が広いので多めに見積もり、長い名前ほど小さくして1行に収める
  const len = Array.from(label).reduce((sum, ch) => {
    if (ch.charCodeAt(0) > 0xff) return sum + 1;
    if (/[A-Z0-9]/.test(ch)) return sum + 0.85;
    return sum + 0.7;
  }, 0);
  line.style.setProperty("--len", Math.max(len, 5));

  wrap
    .querySelector(".kz-logo")
    .setAttribute("aria-label", `${label}ラブがスゴいクイズGP`);
}

// ページ内のロゴを、名前が届くまで「新郎新婦の」で先に描いておく
document.querySelectorAll(".logo-wrap").forEach((wrap) => applyLogoNames(wrap, ""));
