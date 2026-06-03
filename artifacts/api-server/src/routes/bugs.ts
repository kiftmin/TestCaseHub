// Bugs table has been consolidated into the unified defects table.
// All bug tracking functionality is now handled via the defects routes.
// This file is kept as a stub to prevent import errors during transition.
import express from "express";

const router = express.Router();

router.all("*", (req, res) => {
  res.status(410).json({ message: "Bugs module has been deprecated. Use the defects API instead." });
});

export default router;
