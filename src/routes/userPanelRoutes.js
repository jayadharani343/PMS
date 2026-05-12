const express = require("express");
const { protect, restrictTo } = require("../middleware/auth");
const {
  getMe,
  updateMe,
  updatePassword,
  deleteMe,
  getDashboard,
  getMyProjects,
  getMyProjectById,
  updateMyProject,
  deleteMyProject,
  getMyTasks,
  getMyTaskById,
  createMyTask,
  updateMyTask,
  updateMyTaskStatus,
  deleteMyTask,
} = require("../controllers/userPanelController");

const router = express.Router();

router.use(protect, restrictTo("user"));

router.get("/me", getMe);
router.patch("/me", updateMe);
router.patch("/me/password", updatePassword);
router.delete("/me", deleteMe);

router.get("/dashboard", getDashboard);

router.get("/projects", getMyProjects);
router.get("/projects/:id", getMyProjectById);
router.patch("/projects/:id", updateMyProject);
router.delete("/projects/:id", deleteMyProject);

router.get("/tasks", getMyTasks);
router.post("/tasks", createMyTask);
router.get("/tasks/:id", getMyTaskById);
router.patch("/tasks/:id", updateMyTask);
router.patch("/tasks/:id/status", updateMyTaskStatus);
router.delete("/tasks/:id", deleteMyTask);

module.exports = router;
