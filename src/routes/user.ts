import { Router } from "express";
import { updateProfile, getProfile, uploadAvatar, uploadAiAvatar, deleteAvatar, deleteAiAvatar } from "../controllers/user";
import { auth } from "../middleware/auth";
import multer from "multer";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

// All user routes require authentication
router.use(auth);

router.get("/me", getProfile);
router.put("/profile", updateProfile);
router.post("/upload-avatar", upload.single("image") as any, uploadAvatar);
router.post("/upload-ai-avatar", upload.single("image") as any, uploadAiAvatar);
router.delete("/delete-avatar", deleteAvatar);
router.delete("/delete-ai-avatar", deleteAiAvatar);

export default router;
