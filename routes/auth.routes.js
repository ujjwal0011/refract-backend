import express from "express";
import passport from "passport";
import { authenticate } from "../middlewares/auth.js";
import {
  googleCallback,
  getCurrentUser,
  logout,
  authFailure,
} from "../controllers/auth.controller.js";

const router = express.Router();

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/auth/failure",
  }),
  googleCallback
);

router.get("/failure", authFailure);

router.get("/me", authenticate, getCurrentUser);

router.get("/logout", logout);

export default router;
