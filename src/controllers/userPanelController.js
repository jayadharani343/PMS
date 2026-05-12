const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const Task = require("../models/Task");
const { asyncHandler } = require("../utils/asyncHandler");

const MS_DAY = 24 * 60 * 60 * 1000;

/** GET /api/user/me — Read profile */
const getMe = asyncHandler(async (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt,
  });
});

/** PATCH /api/user/me — Update profile (CRUD: Update) */
const updateMe = asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  if (email && email !== req.user.email) {
    const taken = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (taken) {
      return res.status(409).json({ message: "Email already in use" });
    }
    req.user.email = email;
  }
  if (name !== undefined) req.user.name = name;
  await req.user.save();
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});

/** PATCH /api/user/me/password */
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "currentPassword and newPassword are required" });
  }
  const user = await User.findById(req.user._id).select("+password");
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }
  user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await user.save();
  res.json({ message: "Password updated" });
});

/** DELETE /api/user/me — Delete own account (CRUD: Delete) */
const deleteMe = asyncHandler(async (req, res) => {
  await Task.deleteMany({ assignedTo: req.user._id });
  await User.findByIdAndDelete(req.user._id);
  res.status(204).send();
});

/** GET /api/user/dashboard */
const getDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const base = { assignedTo: userId };

  const [pending, inProgress, completed, total] = await Promise.all([
    Task.countDocuments({ ...base, status: "Pending" }),
    Task.countDocuments({ ...base, status: "In Progress" }),
    Task.countDocuments({ ...base, status: "Completed" }),
    Task.countDocuments(base),
  ]);

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * MS_DAY);
  const upcomingDeadlines = await Task.find({
    ...base,
    deadline: { $gte: now, $lte: weekAhead },
    status: { $ne: "Completed" },
  })
    .populate("project", "title")
    .sort({ deadline: 1 })
    .limit(20)
    .lean();

  const highPriority = await Task.find({
    ...base,
    priority: "High",
    status: { $ne: "Completed" },
  })
    .populate("project", "title")
    .sort({ deadline: 1 })
    .limit(20)
    .lean();

  const recentlyUpdated = await Task.find(base)
    .populate("project", "title")
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  res.json({
    stats: { total, pending, inProgress, completed },
    upcomingDeadlines,
    highPriority,
    recentlyUpdated,
  });
});

/** GET /api/user/projects — projects where the user has assigned tasks */
const getMyProjects = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const projectIds = await Task.distinct("project", { assignedTo: userId });
  const projects = await Project.find({ _id: { $in: projectIds } }).lean();

  const enriched = await Promise.all(
    projects.map(async (p) => {
      const tasks = await Task.find({
        project: p._id,
        assignedTo: userId,
      }).lean();
      const total = tasks.length;
      const done = tasks.filter((t) => t.status === "Completed").length;
      const completionPercent = total ? Math.round((done / total) * 100) : 0;
      return {
        ...p,
        taskCountForMe: total,
        completedCountForMe: done,
        completionPercent,
      };
    })
  );

  res.json(enriched);
});

/** GET /api/user/projects/:id */
const getMyProjectById = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid project id" });
  }
  const hasTask = await Task.exists({ project: id, assignedTo: userId });
  if (!hasTask) {
    return res.status(404).json({ message: "Project not found or no access" });
  }
  const project = await Project.findById(id).lean();
  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }
  const tasks = await Task.find({ project: id, assignedTo: userId }).lean();
  res.json({ ...project, myTasks: tasks });
});

/** PATCH /api/user/projects/:id — Update project basics (title/description)
 * Access: user must have at least one task assigned in that project.
 */
const updateMyProject = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid project id" });
  }

  const hasTask = await Task.exists({ project: id, assignedTo: userId });
  if (!hasTask) {
    return res.status(404).json({ message: "Project not found or no access" });
  }

  const { title, description } = req.body;
  const project = await Project.findById(id);
  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }

  if (title !== undefined) project.title = String(title).trim();
  if (description !== undefined) project.description = String(description);

  await project.save();
  res.json(project.toObject());
});

/** DELETE /api/user/projects/:id — Delete project only if no other users have tasks
 * Access: user must have tasks in the project, and all tasks must belong to this user.
 */
const deleteMyProject = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid project id" });
  }

  const hasTask = await Task.exists({ project: id, assignedTo: userId });
  if (!hasTask) {
    return res.status(404).json({ message: "Project not found or no access" });
  }

  const otherUserTasksCount = await Task.countDocuments({
    project: id,
    assignedTo: { $ne: userId },
  });

  if (otherUserTasksCount > 0) {
    return res
      .status(403)
      .json({ message: "Cannot delete project assigned to other users" });
  }

  await Task.deleteMany({ project: id });
  await Project.findByIdAndDelete(id);
  res.status(204).send();
});

function buildTaskFilter(userId, query) {
  const filter = { assignedTo: userId };
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.projectId) {
    if (!mongoose.isValidObjectId(query.projectId)) {
      return { error: "Invalid projectId" };
    }
    filter.project = query.projectId;
  }
  if (query.overdue === "true") {
    filter.deadline = { $lt: new Date() };
    filter.status = { $ne: "Completed" };
  }
  return { filter };
}

/** GET /api/user/tasks */
const getMyTasks = asyncHandler(async (req, res) => {
  const built = buildTaskFilter(req.user._id, req.query);
  if (built.error) {
    return res.status(400).json({ message: built.error });
  }
  const tasks = await Task.find(built.filter)
    .populate("project", "title description")
    .sort({ deadline: 1, createdAt: -1 })
    .lean();
  res.json(tasks);
});

/** GET /api/user/tasks/:id */
const getMyTaskById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid task id" });
  }
  const task = await Task.findOne({
    _id: id,
    assignedTo: req.user._id,
  })
    .populate("project", "title description")
    .lean();
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }
  res.json(task);
});

/** PATCH /api/user/tasks/:id — partial update (CRUD: Update) */
const updateMyTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid task id" });
  }
  const task = await Task.findOne({ _id: id, assignedTo: req.user._id });
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }

  // Allow update fields used by the user-panel UI.
  if (req.body.title !== undefined) task.title = String(req.body.title).trim();
  if (req.body.description !== undefined)
    task.description = String(req.body.description);

  // Support either { status: "Pending" | "In Progress" | "Completed" }
  // or { done: true | false } from UI.
  if (req.body.status !== undefined) {
    if (!Task.TASK_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        message: `status must be one of: ${Task.TASK_STATUSES.join(", ")}`,
      });
    }
    task.status = req.body.status;
  } else if (req.body.done !== undefined) {
    task.status = req.body.done ? "Completed" : "Pending";
  }

  if (req.body.priority !== undefined) {
    if (!Task.TASK_PRIORITIES.includes(req.body.priority)) {
      return res.status(400).json({
        message: `priority must be one of: ${Task.TASK_PRIORITIES.join(", ")}`,
      });
    }
    task.priority = req.body.priority;
  }

  if (req.body.deadline !== undefined) {
    const d = new Date(req.body.deadline);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ message: "Invalid deadline date" });
    }
    task.deadline = d;
  }

  await task.save();
  const populated = await Task.findById(task._id)
    .populate("project", "title description")
    .lean();
  res.json(populated);
});

/** PATCH /api/user/tasks/:id/status */
const updateMyTaskStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, done } = req.body;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid task id" });
  }
  const resolvedStatus =
    status !== undefined ? status : done !== undefined ? (done ? "Completed" : "Pending") : null;

  if (!resolvedStatus || !Task.TASK_STATUSES.includes(resolvedStatus)) {
    return res.status(400).json({
      message: `status (or done) is required and must be one of: ${Task.TASK_STATUSES.join(
        ", "
      )}`,
    });
  }
  const task = await Task.findOne({ _id: id, assignedTo: req.user._id });
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }
  task.status = resolvedStatus;
  await task.save();
  const populated = await Task.findById(task._id)
    .populate("project", "title description")
    .lean();
  res.json(populated);
});

/**
 * POST /api/user/tasks — Create task assigned to self (optional CRUD; admin usually assigns).
 * Kept for completeness / testing; only creates tasks for own userId.
 */
const createMyTask = asyncHandler(async (req, res) => {
  const { title, description, status, priority, deadline, project } = req.body;
  if (!title || !project) {
    return res
      .status(400)
      .json({ message: "title and project (project ObjectId) are required" });
  }
  if (!mongoose.isValidObjectId(project)) {
    return res.status(400).json({ message: "Invalid project id" });
  }
  const projectDoc = await Project.findById(project);
  if (!projectDoc) {
    return res.status(404).json({ message: "Project not found" });
  }
  const task = await Task.create({
    title,
    description: description ?? "",
    status: status && Task.TASK_STATUSES.includes(status) ? status : "Pending",
    priority:
      priority && Task.TASK_PRIORITIES.includes(priority) ? priority : "Medium",
    deadline: deadline ? new Date(deadline) : undefined,
    project,
    assignedTo: req.user._id,
  });
  const populated = await Task.findById(task._id)
    .populate("project", "title description")
    .lean();
  res.status(201).json(populated);
});

/** DELETE /api/user/tasks/:id — only if assigned to me */
const deleteMyTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid task id" });
  }
  const task = await Task.findOneAndDelete({
    _id: id,
    assignedTo: req.user._id,
  });
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }
  res.status(204).send();
});

module.exports = {
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
  updateMyTask,
  updateMyTaskStatus,
  createMyTask,
  deleteMyTask,
};
