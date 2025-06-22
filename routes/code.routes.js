import express from "express";
import dotenv from "dotenv";
import {
  getCharacters,
  createReview,
  getReviews,
  getReviewById,
  deleteReview,
} from "../controllers/review.controller.js";
import { authenticate } from "../middlewares/auth.js";
import { rateLimiter } from "../middlewares/rateLimitter.js";

dotenv.config();

const router = express.Router();

router.get("/characters", authenticate, getCharacters);

router.post("/", authenticate, rateLimiter, createReview);

router.get("/", authenticate, getReviews);

router.get("/:id", authenticate, getReviewById);

router.delete("/:id", authenticate, deleteReview);

export default router;
