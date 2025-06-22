import mongoose from "mongoose";

const codeReviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  code: { type: String, required: true },
  review: { type: String },
  language: { type: String },
  reviewStyle: { type: String },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("CodeReview", codeReviewSchema);
