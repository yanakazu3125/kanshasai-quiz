const mongoose = require("mongoose");

const operatorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // ハッシュ化されたパスワード
  email: { type: String },
  roomId: { type: String, required: true, unique: true }, // この運用者のルームID
  titleImageUrl: { type: String }, // タイトル画面の左下に表示する画像のURL
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

module.exports = mongoose.model("Operator", operatorSchema);
