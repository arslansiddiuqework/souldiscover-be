import express from "express";
import {
  createChatSession,
  getChatSession,
  sendMessage,
  getChatHistory,
  getUserSessions,
  deleteChatSession,
} from "../controllers/chat";
import { auth } from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";

const router = express.Router();

// Apply auth middleware to all routes
router.use(auth);

// Get all chat sessions for user
router.get("/sessions", getUserSessions);

// Create a new chat session
router.post("/sessions", createChatSession);

// Get a specific chat session
router.get("/sessions/:sessionId", getChatSession);

// Delete a specific chat session
router.delete("/sessions/:sessionId", deleteChatSession);

// Send a message in a chat session (expensive AI path — rate limited)
router.post("/sessions/:sessionId/messages", chatRateLimit, sendMessage);

// Get chat history for a session
router.get("/sessions/:sessionId/history", getChatHistory);

export default router;
