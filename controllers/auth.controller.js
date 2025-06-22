import jwt from "jsonwebtoken";

export const googleCallback = (req, res) => {
  try {
    const user = req.user;

    if (!user || !user._id || !user.email) {
      return res.status(400).json({
        success: false,
        message: "Invalid user data received from Google",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return res.status(500).json({
        success: false,
        message: "Server configuration error",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Only secure in production
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // "none" for cross-origin
      domain: process.env.NODE_ENV === "production" ? undefined : undefined // Let browser decide
    });

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      console.error("FRONTEND_URL is not configured");
      return res.status(500).json({
        success: false,
        message: "Server configuration error",
      });
    }

  
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }
};

export const getCurrentUser = (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    res.status(200).json(req.user);
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user data",
    });
  }
};

export const logout = (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to logout",
    });
  }
};

export const authFailure = (req, res) => {
  try {
    const errorMessage = req.query.error || "Authentication failed";

    res.status(401).json({
      success: false,
      message: errorMessage,
    });
  } catch (error) {
    console.error("Auth failure handler error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication system error",
    });
  }
};
