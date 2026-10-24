import { Router } from "express";
import {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  googleAuth,
} from "../controllers/auth";
import { auth } from "../middleware/auth";
import {
  authRateLimit,
  passwordResetRateLimit,
} from "../middleware/rateLimit";

const router = Router();

router.post("/register", authRateLimit, register);
router.post("/login", authRateLimit, login);
router.post("/logout", auth, logout);
router.post("/google", authRateLimit, googleAuth);
router.post("/forgot-password", passwordResetRateLimit, forgotPassword);
router.post("/reset-password", passwordResetRateLimit, resetPassword);
router.get("/me", auth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
