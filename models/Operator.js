const mongoose = require("mongoose");

const operatorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // ハッシュ化されたパスワード
  email: { type: String },
  roomId: { type: String, required: true, unique: true }, // この運用者のルームID
  titleImageUrl: { type: String }, // タイトル画面の左下に表示する画像のURL
  titleImageRightUrl: { type: String }, // タイトル画面の右下に表示する画像のURL
  titleNames: { type: String }, // タイトルロゴの「新郎新婦の」の代わりに表示する名前
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

module.exports = mongoose.model("Operator", operatorSchema);
