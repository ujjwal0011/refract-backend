const requestTracker = new Map();

export const RATE_LIMIT = {
  maxRequests: 10, // Maximum 10 requests per user
  windowMs: 60 * 60 * 1000, // 1 hour
  minDelay: 4000, // Minimum 4 seconds between requests
};

export const rateLimiter = (req, res, next) => {
  const userId = req.user.id;
  const now = Date.now();

  if (!requestTracker.has(userId)) {
    requestTracker.set(userId, { requests: [], lastRequest: 0 });
  }

  const userRequests = requestTracker.get(userId);

  userRequests.requests = userRequests.requests.filter(
    (timestamp) => now - timestamp < RATE_LIMIT.windowMs
  );

  if (userRequests.requests.length >= RATE_LIMIT.maxRequests) {
    return res.status(429).json({
      message: "Too many requests. Please wait before making another request.",
      retryAfter: Math.ceil(
        (userRequests.requests[0] + RATE_LIMIT.windowMs - now) / 1000
      ),
    });
  }

  if (now - userRequests.lastRequest < RATE_LIMIT.minDelay) {
    return res.status(429).json({
      message: "Please wait a few seconds between requests.",
      retryAfter: Math.ceil(
        (userRequests.lastRequest + RATE_LIMIT.minDelay - now) / 1000
      ),
    });
  }

  userRequests.requests.push(now);
  userRequests.lastRequest = now;

  next();
};
