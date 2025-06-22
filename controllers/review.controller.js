import { GoogleGenerativeAI } from "@google/generative-ai";
import CodeReview from "../models/code.model.js";
import { retryWithBackoff } from "../utils/retryUtils.js";
import { validateCodeInput } from "../utils/validation.js";
import { reviewStyles } from "../data/reviewStyles.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const handleAsyncError = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error(`Error in ${fn.name}:`, error);
    res.status(500).json({
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getCharacters = handleAsyncError(async (req, res) => {
  if (!reviewStyles || !Array.isArray(reviewStyles)) {
    return res.status(500).json({
      message: "Review styles configuration not available",
    });
  }

  try {
    const groupedCharacters = reviewStyles.reduce((acc, style) => {
      if (!style.category || !style.id || !style.name) {
        console.warn("Invalid style configuration:", style);
        return acc;
      }

      if (!acc[style.category]) {
        acc[style.category] = [];
      }
      acc[style.category].push({
        id: style.id,
        name: style.name,
        emoji: style.emoji || "🤖",
      });
      return acc;
    }, {});

    const characters = reviewStyles
      .filter((style) => style.id && style.name && style.category)
      .map((style) => ({
        id: style.id,
        name: style.name,
        category: style.category,
        emoji: style.emoji || "🤖",
      }));

    res.status(200).json({
      characters,
      grouped: groupedCharacters,
      count: characters.length,
    });
  } catch (error) {
    console.error("Error processing characters data:", error);
    res.status(500).json({
      message: "Failed to process characters data",
    });
  }
});

export const createReview = handleAsyncError(async (req, res) => {
  const { code, language, characterId, description } = req.body;

  if (!req.user?.id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return res
      .status(400)
      .json({ message: "Code is required and cannot be empty" });
  }

  if (!language || typeof language !== "string") {
    return res
      .status(400)
      .json({ message: "Programming language is required" });
  }

  if (!characterId) {
    return res.status(400).json({ message: "Character selection is required" });
  }

  const validation = validateCodeInput(code, characterId);
  if (!validation.isValid) {
    return res.status(400).json({ message: validation.message });
  }

  const selectedStyle = reviewStyles.find((style) => style.id === characterId);
  if (!selectedStyle) {
    return res.status(400).json({
      message: "Invalid character selection",
      availableCharacters: reviewStyles.map((s) => s.id),
    });
  }

  if (!selectedStyle.personality) {
    return res.status(500).json({
      message: "Character configuration incomplete",
    });
  }

  try {
    const reviewText = await generateReview(
      code,
      language,
      selectedStyle,
      description
    );

    if (!reviewText || reviewText.trim().length === 0) {
      return res.status(500).json({
        message: "Failed to generate review content",
      });
    }

    const reviewDoc = await CodeReview.create({
      userId: req.user.id,
      code: code.trim(),
      review: reviewText,
      language: language,
      reviewStyle: selectedStyle.name,
      description: description ? description.trim() : null,
    });

    if (!reviewDoc) {
      return res.status(500).json({
        message: "Failed to save review to database",
      });
    }

    res.status(201).json({
      ...reviewDoc.toObject(),
      message: "Review completed successfully",
      reviewStyle: selectedStyle.name,
      reviewCharacter: {
        id: selectedStyle.id,
        name: selectedStyle.name,
        emoji: selectedStyle.emoji || "🤖",
      },
    });
  } catch (error) {
    handleReviewGenerationError(error, res);
  }
});

export const getReviews = handleAsyncError(async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  try {
    const [reviews, totalCount] = await Promise.all([
      CodeReview.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-__v")
        .lean(),
      CodeReview.countDocuments({ userId: req.user.id }),
    ]);

    res.status(200).json({
      reviews: reviews || [],
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
        hasNext: page * limit < totalCount,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Database error fetching reviews:", error);
    res.status(500).json({
      message: "Failed to fetch reviews",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getReviewById = handleAsyncError(async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Review ID is required" });
  }

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(400).json({ message: "Invalid review ID format" });
  }

  try {
    const review = await CodeReview.findOne({
      _id: id,
      userId: req.user.id,
    })
      .select("-__v")
      .lean();

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    res.status(200).json(review);
  } catch (error) {
    console.error("Database error fetching review:", error);

    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    res.status(500).json({
      message: "Failed to fetch review",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const deleteReview = handleAsyncError(async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Review ID is required" });
  }

  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(400).json({ message: "Invalid review ID format" });
  }

  try {
    const review = await CodeReview.findOneAndDelete({
      _id: id,
      userId: req.user.id,
    });

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    res.status(200).json({
      message: "Review deleted successfully",
      deletedId: id,
    });
  } catch (error) {
    console.error("Database error deleting review:", error);

    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid review ID" });
    }

    res.status(500).json({
      message: "Failed to delete review",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

const generateReview = async (code, language, selectedStyle, description) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      },
    });

    const descriptionContext = description
      ? `\n\n**Additional Context from the Developer:**\n"${description}"\n\nPlease consider this context in your review and address any specific concerns or questions mentioned.`
      : "";

    const prompt = `${selectedStyle.personality}

You're reviewing this ${language} code. Give a complete, detailed review that's both helpful and entertaining. Deliver a full, immersive review in character. Be entertaining, brutally honest or heroically inspiring—however your persona demands—but always deeply insightful. Your job is not just to critique, it is to mentor, challenge, and transform or roast as per your persona but main motive is turning this code into something legendary. Don't hold back - provide a thorough analysis while staying in character.
${descriptionContext}

Code to review:
\`\`\`${language}
${code}
\`\`\`

Character-Driven Review Standards
Your technical expertise must shine through your unique personality. Whether you're a wise sage, theatrical critic, or sharp-tongued mentor, weave these standards into your character:

Deliver Memorable Feedback: Make your insights stick—be detailed yet engaging, explaining not just what's wrong but why it matters in your distinctive voice
Craft Inspiring Solutions: Don't just point out problems; become the guide who shows the path forward with refactored code and brilliant alternatives
Hunt Performance Demons: Channel your persona to expose bottlenecks and inefficiencies—make optimization feel like an epic quest or surgical precision
Guard the Digital Fortress: Approach security with the gravity it deserves—whether as a vigilant protector or seasoned warrior warning of vulnerabilities
Champion Code Harmony: Enforce consistency like a conductor leading an orchestra—every naming convention and format should sing in unison
Preach the Sacred Principles: Make DRY and SOLID principles feel like fundamental truths worth following, not just academic concepts
Slay Complexity Dragons: Identify overcomplicated code with the eye of someone who's seen too much chaos—advocate for elegant simplicity
Demand Battle-Tested Code: Approach testing like a strategist—every function should be proven worthy through proper coverage
Illuminate the Path: Turn documentation from a chore into a gift to future developers—make clarity feel noble and necessary
Herald the Future: Be the voice that bridges today's code with tomorrow's possibilities—make modern practices feel exciting and inevitable

Structure your review with these sections (but make them fit your character):
🎭 Opening Remarks - Your first impression in character and Start with your first impression. Let your personality show—whether it's theatrical, analytical, noble, sarcastic, or all-seeing.

🔍 Code Analysis - Dive deep into the logic, structure, patterns, and techniques. What stands out in the architecture or flow? Reveal what others might miss.

⚡ The Good Stuff - What parts of this code are powerful, clean, or cleverly done? Celebrate victories, big or small.

🚨 Issues & Concerns - Point out flaws, inefficiencies, smells, anti-patterns, or any logical chaos. Whether it's villainous bugs or clumsy constructs, call them out.

🛠️ Improvement Suggestions - Specific actionable advice and Give clear, actionable advice to elevate the code. Suggest better logic, improved structure, or more expressive approaches.

🔒 Security & Performance - Any concerns in these areas or Comment on any vulnerabilities, bottlenecks, or missed opportunities for optimization. If all is well, say so with confidence.

🎓 Final Wisdom - Wrap up with character-appropriate advice and Close with your signature touch. Offer motivation, caution, or a final verdict as only you can. Leave the coder enlightened—or challenged to do better.

Tone & Character Guidelines

Be Memorable: Your reviews should be something developers want to come back to
Stay In Character: Whether you're a wise mentor, theatrical critic, or sharp-tongued expert, maintain consistency
Balance Entertainment with Substance: Never sacrifice technical accuracy for entertainment
Be Brutally Honest but Constructive: Point out flaws clearly while providing paths to improvement
Provide Real-World Context: Use examples and explain the "why" behind your suggestions
Assume Competence: Treat the developer as capable while offering room for growth
Make It Personal: Adapt your approach to inspire, challenge, or guide as your character demands

When showing code improvements, use this structure:
❌ Current Code Issues:
language// problematic code here
🔍 Technical Problems:

Specific issue 1 with explanation
Specific issue 2 with explanation

✅ Improved Implementation:
language// better code here
💡 Key Improvements:

Technical benefit 1
Technical benefit 2

Make it engaging, thorough, and genuinely helpful. Don't rush - give a complete review that covers all important aspects of the code and Make this review something the coder will remember, learn from, and want to come back to. Be bold, be sharp, be in character.`;

    const generateContent = async () => {
      const result = await model.generateContent(prompt);
      const response = result.response;

      if (!response) {
        throw new Error("No response from AI model");
      }

      const text = response.text();
      if (!text || text.trim().length === 0) {
        throw new Error("Empty response from AI model");
      }

      return text;
    };

    return await retryWithBackoff(generateContent);
  } catch (error) {
    console.error("Error generating review:", error);
    throw error;
  }
};

const handleReviewGenerationError = (error, res) => {
  console.error("Review generation error:", error);

  if (
    error.status === 429 ||
    error.message?.includes("quota") ||
    error.message?.includes("rate limit")
  ) {
    return res.status(429).json({
      message: "API rate limit exceeded. Please try again in a few minutes.",
      retryAfter: 60,
      type: "rate_limit",
    });
  }

  if (
    error.status === 400 ||
    error.message?.includes("invalid") ||
    error.message?.includes("bad request")
  ) {
    return res.status(400).json({
      message: "Invalid request. Please check your code and try again.",
      type: "invalid_request",
    });
  }

  if (
    error.status === 401 ||
    error.status === 403 ||
    error.message?.includes("API key")
  ) {
    return res.status(500).json({
      message: "AI service configuration error. Please contact support.",
      type: "configuration_error",
    });
  }

  if (error.message?.includes("safety") || error.message?.includes("blocked")) {
    return res.status(400).json({
      message:
        "Content blocked by safety filters. Please review your code and try again.",
      type: "content_blocked",
    });
  }

  if (
    error.code === "ECONNREFUSED" ||
    error.code === "ETIMEDOUT" ||
    error.message?.includes("timeout")
  ) {
    return res.status(503).json({
      message:
        "AI service temporarily unavailable. Please try again in a moment.",
      retryAfter: 30,
      type: "service_unavailable",
    });
  }

  res.status(500).json({
    message: "Review service temporarily unavailable. Please try again later.",
    type: "internal_error",
    error: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
};
