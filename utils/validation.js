export const validateCodeInput = (code, characterId) => {
  if (!code) {
    return {
      isValid: false,
      message: "Code is required",
    };
  }

  if (!characterId) {
    return {
      isValid: false,
      message: "Character selection is required",
    };
  }

  if (code.length > 5000) {
    return {
      isValid: false,
      message: "Code is too long. Please limit to 5000 characters.",
    };
  }

  return {
    isValid: true,
  };
};
